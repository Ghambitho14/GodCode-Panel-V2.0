/**
 * Hook de edicion de pedidos existentes.
 *
 * Clona la API publica de `useManualOrder` pero arranca con un pedido ya
 * creado en la tabla `orders`. Al guardar llama `ordersService.updateOrder`
 * (UPDATE via RLS) en lugar de `createManualOrder`.
 *
 * Convenciones:
 * - `initialOrder.items` ya viene en formato carrito (id, name, price, quantity).
 * - `initialOrder.delivery_address` puede ser objeto JSONB con `address`,
 *   `reference`, `named_area_id`, `named_area_label`. Lo aplanamos para que el
 *   formulario lo edite como strings simples (igual que `useManualOrder`).
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { formatRut, validateRut } from '@/shared/utils/formatters';
import { validateImageFile } from '@/shared/utils/cloudinary';
import { ordersService } from '../admin/orders/services/orders';
import { supabase, TABLES } from '@/integrations/supabase';
import { buildCouponPreview } from '@/lib/discount-coupon';

const PREVIEW_ERR_MSG = {
	empty: '',
	invalid_coupon: 'Código no válido o cupón desactivado.',
	coupon_expired: 'Este cupón no está vigente.',
	coupon_min_subtotal: 'El subtotal no alcanza el mínimo del cupón.',
	coupon_wrong_client: 'Este cupón solo aplica con el teléfono del cliente autorizado.',
	coupon_usage_exhausted: 'Este cupón ya no tiene usos disponibles.',
	coupon_usage_exhausted_client: 'Este cupón ya fue usado con este teléfono.',
};

/** Aplana `delivery_address` JSONB a strings simples para el form. */
function flattenDeliveryAddress(addr) {
	if (!addr || typeof addr !== 'object' || Array.isArray(addr)) {
		const line = typeof addr === 'string' ? addr : '';
		return {
			delivery_address: line,
			delivery_reference: '',
			delivery_named_area_id: '',
		};
	}
	const line =
		typeof addr.address === 'string'
			? addr.address
			: typeof addr.formatted_address === 'string'
				? addr.formatted_address
				: '';
	const ref =
		typeof addr.reference === 'string'
			? addr.reference
			: typeof addr.street_detail === 'string'
				? addr.street_detail
				: '';
	const nid =
		typeof addr.named_area_id === 'string' ? addr.named_area_id.trim() : '';
	return {
		delivery_address: line,
		delivery_reference: ref,
		delivery_named_area_id: nid,
	};
}

/** Normaliza el order_type del pedido al formato del formulario. */
function normalizeOrderType(raw) {
	const t = String(raw ?? 'pickup').trim().toLowerCase();
	if (t === 'delivery' || t === 'envio' || t === 'envío' || t === 'despacho') {
		return 'delivery';
	}
	return 'pickup';
}

function buildInitialState(initialOrder) {
	if (!initialOrder || typeof initialOrder !== 'object') {
		return {
			client_name: '',
			client_rut: '',
			client_phone: '',
			items: [],
			total: 0,
			payment_type: 'tienda',
			order_type: 'pickup',
			delivery_address: '',
			delivery_reference: '',
			delivery_km: '',
			delivery_fee: 0,
			delivery_named_area_id: '',
			note: '',
			coupon_code: '',
		};
	}
	const items = Array.isArray(initialOrder.items) ? initialOrder.items.map((it) => ({
		id: String(it.id ?? ''),
		name: String(it.name ?? ''),
		price: Number(it.price) || 0,
		has_discount: Boolean(it.has_discount),
		discount_price: it.discount_price ?? null,
		image_url: it.image_url ?? null,
		description: it.description ?? null,
		quantity: Math.max(1, Number(it.quantity) || 1),
		// Preservamos el comentario del item para que aparezca poblado cuando
		// reabren el pedido (originado en manual order o en una edicion previa).
		note: typeof it.note === 'string' ? it.note : '',
		manual_order_source: it.manual_order_source ?? null,
		is_extra: Boolean(it.is_extra),
	})) : [];

	const getPrice = (it) =>
		it?.has_discount && it?.discount_price && Number(it.discount_price) > 0
			? Number(it.discount_price)
			: Number(it.price || 0);
	const computedTotal = Math.round(
		items.reduce((acc, it) => acc + getPrice(it) * (Number(it.quantity) || 1), 0),
	);

	const orderType = normalizeOrderType(
		initialOrder.channel ?? initialOrder.order_type ?? 'pickup',
	);
	const flatAddr = flattenDeliveryAddress(initialOrder.delivery_address);

	return {
		client_name: String(initialOrder.client_name ?? ''),
		client_rut: String(initialOrder.client_rut ?? ''),
		client_phone: String(initialOrder.client_phone ?? ''),
		items,
		total: computedTotal,
		payment_type: String(initialOrder.payment_type ?? 'tienda'),
		order_type: orderType,
		delivery_address: orderType === 'delivery' ? flatAddr.delivery_address : '',
		delivery_reference: orderType === 'delivery' ? flatAddr.delivery_reference : '',
		delivery_km: '',
		delivery_fee: orderType === 'delivery' ? Number(initialOrder.delivery_fee) || 0 : 0,
		delivery_named_area_id: orderType === 'delivery' ? flatAddr.delivery_named_area_id : '',
		note: String(initialOrder.note ?? '').replace(/^\[Sucursal: [^\]]+\]\s*\n?/i, '').replace(/\n?\[Envío: [^\]]+\]/i, ''),
		coupon_code: '',
	};
}

export const useOrderEdit = (
	showNotify,
	onSaved,
	onClose,
	branch,
	branchDeliveryCfg,
	initialOrder,
) => {
	const initialState = useMemo(
		() => buildInitialState(initialOrder),
		[initialOrder],
	);

	const [manualOrder, setManualOrder] = useState(() => initialState);
	const [loading, setLoading] = useState(false);
	const [couponPreview, setCouponPreview] = useState(() => ({
		loading: false,
		discount: 0,
		message: '',
		variant: 'neutral',
	}));

	const [rutValid, setRutValid] = useState(() =>
		validateRut(String(initialOrder?.client_rut ?? '')),
	);
	const [phoneValid, setPhoneValid] = useState(() => {
		const digitCount = String(initialOrder?.client_phone ?? '').replace(/\D/g, '').length;
		return digitCount >= 11;
	});
	const [receiptFile, setReceiptFile] = useState(null);
	const [receiptPreview, setReceiptPreview] = useState(null);

	const initialItemsSnapshot = useMemo(
		() => JSON.stringify(initialState.items),
		[initialState],
	);

	useEffect(() => {
		return () => {
			if (receiptPreview) URL.revokeObjectURL(receiptPreview);
		};
	}, [receiptPreview]);

	const getPrice = useCallback((product) => {
		if (product?.has_discount && product?.discount_price && Number(product.discount_price) > 0) {
			return Number(product.discount_price);
		}
		return Number(product?.price) || 0;
	}, []);

	const updateClientName = (val) => setManualOrder((prev) => ({ ...prev, client_name: val }));
	const updateCouponCode = (val) =>
		setManualOrder((prev) => ({ ...prev, coupon_code: typeof val === 'string' ? val : '' }));
	const updateNote = (val) => setManualOrder((prev) => ({ ...prev, note: val }));
	const updateOrderType = (val) =>
		setManualOrder((prev) => ({
			...prev,
			order_type: val,
			...(val === 'pickup'
				? {
					delivery_named_area_id: '',
					delivery_fee: 0,
					delivery_address: '',
					delivery_reference: '',
					delivery_km: '',
				}
				: {}),
		}));
	const updateDeliveryAddress = (val) =>
		setManualOrder((prev) => ({ ...prev, delivery_address: val }));
	const updateDeliveryReference = (val) =>
		setManualOrder((prev) => ({
			...prev,
			delivery_reference: typeof val === 'string' ? val : '',
		}));
	const updateDeliveryKm = (val) =>
		setManualOrder((prev) => ({
			...prev,
			delivery_km: val === '' || val == null ? '' : String(val),
		}));
	const updateDeliveryFee = useCallback(
		(val) => setManualOrder((prev) => ({ ...prev, delivery_fee: Number(val) || 0 })),
		[],
	);
	const updateDeliveryNamedAreaId = useCallback(
		(val) =>
			setManualOrder((prev) => ({
				...prev,
				delivery_named_area_id: typeof val === 'string' ? val : '',
			})),
		[],
	);

	const updatePaymentType = (type) => {
		setManualOrder((prev) => ({ ...prev, payment_type: type }));
		if (type !== 'online') {
			setReceiptFile(null);
			setReceiptPreview((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return null;
			});
		}
	};

	const handleRutChange = (e) => {
		const rawValue = e.target.value;
		const formatted = formatRut(rawValue);
		setManualOrder((prev) => ({ ...prev, client_rut: formatted }));
		setRutValid(validateRut(formatted));
	};

	const handlePhoneChange = (e) => {
		let input = e.target.value;
		if (!input.startsWith('+56 9')) {
			if (input.length < 6) input = '+56 9 ';
		}
		const cleaned = input;
		setManualOrder((prev) => ({ ...prev, client_phone: cleaned }));
		const digitCount = cleaned.replace(/\D/g, '').length;
		setPhoneValid(digitCount >= 11);
	};

	const handleFileChange = (e) => {
		const file = e.target.files[0];
		if (file) {
			const { valid, error: validationError } = validateImageFile(file);
			if (!valid) {
				showNotify?.(validationError || 'Archivo no válido', 'error');
				e.target.value = '';
				return;
			}
			if (receiptPreview) URL.revokeObjectURL(receiptPreview);
			setReceiptFile(file);
			setReceiptPreview(URL.createObjectURL(file));
		}
	};

	const removeReceipt = () => {
		setReceiptFile(null);
		setReceiptPreview((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return null;
		});
	};

	const addItem = useCallback(
		(product) => {
			setManualOrder((prev) => {
				const currentItems = prev.items || [];
				const exists = currentItems.find((i) => i.id === product.id);
				let newItems;
				if (exists) {
					if (exists.quantity >= 20) return prev;
					newItems = currentItems.map((i) =>
						i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
					);
				} else {
					newItems = [
						...currentItems,
						{
							id: product.id,
							name: product.name,
							price: product.price,
							has_discount: product.has_discount,
							discount_price: product.discount_price,
							image_url: product.image_url,
							description: product.description,
							quantity: 1,
							note: '',
							manual_order_source: product.manual_order_source || null,
							is_extra: product.manual_order_source === 'extras',
						},
					];
				}
				const newTotal = Math.round(
					newItems.reduce((acc, i) => acc + getPrice(i) * i.quantity, 0),
				);
				return { ...prev, items: newItems, total: newTotal };
			});
		},
		[getPrice],
	);

	const updateQuantity = useCallback(
		(itemId, change) => {
			setManualOrder((prev) => {
				const item = prev.items.find((i) => i.id === itemId);
				if (!item) return prev;
				if (change > 0 && item.quantity >= 20) return prev;
				let newItems;
				if (item.quantity + change < 1) {
					newItems = prev.items.map((i) => (i.id === itemId ? { ...i, quantity: 1 } : i));
				} else {
					newItems = prev.items.map((i) =>
						i.id === itemId ? { ...i, quantity: i.quantity + change } : i,
					);
				}
				const newTotal = Math.round(
					newItems.reduce((acc, i) => acc + getPrice(i) * i.quantity, 0),
				);
				return { ...prev, items: newItems, total: newTotal };
			});
		},
		[getPrice],
	);

	const removeItem = useCallback(
		(itemId) => {
			setManualOrder((prev) => {
				const newItems = prev.items.filter((i) => i.id !== itemId);
				const newTotal = Math.round(
					newItems.reduce((acc, i) => acc + getPrice(i) * i.quantity, 0),
				);
				return { ...prev, items: newItems, total: newTotal };
			});
		},
		[getPrice],
	);

	// Comentario por item: nota corta destinada al ticket de cocina.
	// Limitada a 140 chars para que no rompa el ancho del ticket termico.
	const updateItemNote = useCallback((itemId, note) => {
		const next = typeof note === 'string' ? note.slice(0, 140) : '';
		setManualOrder((prev) => ({
			...prev,
			items: prev.items.map((i) => (i.id === itemId ? { ...i, note: next } : i)),
		}));
	}, []);

	/** No reseteamos a defaults: el modal de edicion no se reusa con otro pedido. */
	const resetOrder = useCallback(() => {
		setManualOrder(initialState);
		setReceiptFile(null);
		setReceiptPreview((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return null;
		});
		setRutValid(validateRut(initialState.client_rut));
		const digitCount = initialState.client_phone.replace(/\D/g, '').length;
		setPhoneValid(digitCount >= 11);
	}, [initialState]);

	useEffect(() => {
		if (!branch?.company_id) {
			setCouponPreview((p) =>
				p.variant === 'neutral' && p.discount === 0 && !p.message && !p.loading
					? p
					: { loading: false, discount: 0, message: '', variant: 'neutral' },
			);
			return undefined;
		}
		const rawCode = String(manualOrder.coupon_code ?? '').trim();
		if (!rawCode) {
			setCouponPreview({ loading: false, discount: 0, message: '', variant: 'neutral' });
			return undefined;
		}
		let cancelled = false;
		const subtotalPreview = manualOrder.total;
		setCouponPreview({ loading: true, discount: 0, message: '', variant: 'neutral' });
		const tid = setTimeout(async () => {
			try {
				const pv = await buildCouponPreview({
					supabase,
					companyId: String(branch.company_id),
					rawCode,
					itemsSubtotal: subtotalPreview,
					clientPhone: String(manualOrder.client_phone ?? '').trim(),
					tablesCoupons: TABLES.discount_coupons,
					tablesClients: TABLES.clients,
					tablesRedemptions: TABLES.discount_coupon_redemptions,
				});
				if (cancelled) return;
				if (!pv.ok) {
					setCouponPreview({
						loading: false,
						discount: 0,
						message: PREVIEW_ERR_MSG[pv.key] || 'No se pudo validar el cupón.',
						variant: 'error',
					});
					return;
				}
				setCouponPreview({
					loading: false,
					discount: pv.discount,
					message: pv.discount > 0 ? 'Cupón válido (estimado; confirma al guardar).' : '',
					variant: pv.discount > 0 ? 'success' : 'neutral',
				});
			} catch {
				if (!cancelled) {
					setCouponPreview({
						loading: false,
						discount: 0,
						message: 'No se pudo validar el cupón.',
						variant: 'error',
					});
				}
			}
		}, 420);
		return () => {
			cancelled = true;
			clearTimeout(tid);
		};
	}, [branch?.company_id, manualOrder.coupon_code, manualOrder.total, manualOrder.client_phone]);

	const submitOrder = async () => {
		if (!initialOrder?.id) {
			showNotify?.('Pedido inválido (sin id).', 'error');
			return;
		}
		if (!branch) {
			showNotify?.('Error: No hay sucursal seleccionada', 'error');
			return;
		}

		const sanitizeInput = (text) => (text ? String(text).replace(/<[^>]*>/g, '').trim() : '');
		// En edicion las reglas son mas laxas que en creacion: hay pedidos
		// (sobre todo los que entran desde la web publica) que se crearon sin
		// RUT o con telefono incompleto. Solo exigimos nombre + items; RUT y
		// telefono se validan SOLO si el cajero los llena.
		if (
			!manualOrder.client_name ||
			manualOrder.client_name.trim().length < 3 ||
			manualOrder.items.length === 0
		) {
			showNotify?.('Faltan datos obligatorios (nombre o items).', 'error');
			return;
		}
		const phoneRaw = String(manualOrder.client_phone || '').trim();
		const phoneDigits = phoneRaw.replace(/\D/g, '').length;
		if (phoneRaw && phoneDigits > 0 && phoneDigits < 11) {
			showNotify?.('Telefono incompleto. Borralo o completalo a +56 9 XXXX XXXX.', 'error');
			return;
		}
		const rutRaw = String(manualOrder.client_rut || '').trim();
		if (rutRaw && !validateRut(rutRaw)) {
			showNotify?.('El RUT ingresado no es válido. Borralo o corrigelo.', 'error');
			return;
		}

		setLoading(true);
		try {
			const itemsForOrder = (manualOrder.items || []).map((item) => ({
				id: item.id,
				name: String(item.name ?? ''),
				quantity: Number(item.quantity) || 1,
				price: Number(item.price) || 0,
				has_discount: Boolean(item.has_discount),
				discount_price:
					item.has_discount && item.discount_price != null
						? Number(item.discount_price)
						: null,
				description: item.description ? String(item.description) : null,
				// Persistimos `note` en el items jsonb. Lo lee SOLO el ticket
				// de cocina; el resync de inventario no lo usa.
				note: item.note ? sanitizeInput(String(item.note)).slice(0, 140) : null,
				manual_order_source: item.manual_order_source || null,
				is_extra: Boolean(item.is_extra),
			}));

			const sanitizedPatch = {
				client_name: sanitizeInput(manualOrder.client_name),
				client_phone: sanitizeInput(manualOrder.client_phone),
				client_rut: sanitizeInput(manualOrder.client_rut),
				note: sanitizeInput(manualOrder.note),
				order_type: manualOrder.order_type,
				items: itemsForOrder,
				payment_type: manualOrder.payment_type,
				delivery_address:
					manualOrder.order_type === 'delivery'
						? sanitizeInput(manualOrder.delivery_address) || ''
						: '',
				delivery_reference:
					manualOrder.order_type === 'delivery'
						? sanitizeInput(manualOrder.delivery_reference) || ''
						: '',
				delivery_named_area_id:
					manualOrder.order_type === 'delivery'
						? String(manualOrder.delivery_named_area_id ?? '').trim() || null
						: null,
				delivery_fee: manualOrder.order_type === 'delivery' ? Number(manualOrder.delivery_fee) || 0 : 0,
				delivery_km:
					manualOrder.order_type === 'delivery' && manualOrder.delivery_km !== ''
						? Number(String(manualOrder.delivery_km).replace(',', '.'))
						: null,
			};

			const itemsChanged = JSON.stringify(itemsForOrder) !== initialItemsSnapshot;

			const updated = await ordersService.updateOrder(initialOrder.id, sanitizedPatch, {
				itemsChanged,
				prevTotal: Number(initialOrder.total) || 0,
				prevStatus: String(initialOrder.status ?? ''),
				branchSettings: branchDeliveryCfg,
				branchName: branch.name,
				logoUrl: null,
				showNotify,
			});

			showNotify?.('Pedido actualizado.', 'success');
			if (onSaved) onSaved(updated);
			if (onClose) onClose();
		} catch (error) {
			showNotify?.(error?.message || 'Error al guardar pedido', 'error');
		} finally {
			setLoading(false);
		}
	};

	const isValid = useMemo(() => {
		return manualOrder.client_name && manualOrder.items.length > 0;
	}, [manualOrder]);

	const getInputStyle = (isValid) => {
		if (isValid === true) return { borderColor: '#25d366', boxShadow: '0 0 0 1px #25d366' };
		if (isValid === false) return { borderColor: '#ff4444', boxShadow: '0 0 0 1px #ff4444' };
		return {};
	};

	return {
		manualOrder,
		loading,
		rutValid,
		phoneValid,
		receiptFile,
		receiptPreview,
		updateClientName,
		updateCouponCode,
		couponPreview,
		updateNote,
		updatePaymentType,
		handleRutChange,
		handlePhoneChange,
		handleFileChange,
		removeReceipt,
		addItem,
		updateQuantity,
		removeItem,
		updateItemNote,
		updateOrderType,
		updateDeliveryAddress,
		updateDeliveryReference,
		updateDeliveryKm,
		updateDeliveryFee,
		updateDeliveryNamedAreaId,
		submitOrder,
		resetOrder,
		isValid,
		getInputStyle,
	};
};
