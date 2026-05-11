/** Etiquetas para método de pago específico (coincide con keys del carrito/SaaS). */
export const PAYMENT_METHOD_LABELS = {
	efectivo: 'Efectivo',
	tarjeta: 'Tarjeta',
	pago_movil: 'Pago Móvil',
	zelle: 'Zelle',
	transferencia_bancaria: 'Transferencia',
	stripe: 'Tarjeta (Online)',
	mercadopago: 'MercadoPago',
	paypal: 'PayPal',
	online: 'Transf.',
	tienda: 'En local'
};

/** Métodos que se consideran "pago online" para desglose y filtros. */
const ONLINE_SPECIFIC_METHODS = new Set(['pago_movil', 'zelle', 'transferencia_bancaria', 'stripe', 'mercadopago', 'paypal']);

/**
 * Devuelve la etiqueta a mostrar para el método de pago (usa payment_method_specific si existe).
 * @param {{ payment_type?: string; payment_method_specific?: string | null }} order
 * @returns {string}
 */
export function getPaymentLabel(order) {
	if (!order) return '—';
	const specific = order.payment_method_specific;
	if (specific && PAYMENT_METHOD_LABELS[specific]) return PAYMENT_METHOD_LABELS[specific];
	const type = order.payment_type || '';
	if (type === 'online') return 'Transf.';
	if (type === 'tarjeta') return 'Tarjeta';
	if (type === 'tienda') return 'Efectivo';
	return type || '—';
}

/**
 * Indica si el pedido es pago online (transferencia, Zelle, etc.) para filtros y desglose.
 * @param {{ payment_type?: string; payment_method_specific?: string | null }} order
 * @returns {boolean}
 */
export function isOnlineOrder(order) {
	if (!order) return false;
	if (order.payment_type === 'online' || order.payment_type === 'transferencia') return true;
	return Boolean(order.payment_method_specific && ONLINE_SPECIFIC_METHODS.has(order.payment_method_specific));
}

/**
 * Texto plano para pegar en WhatsApp o compartir el pedido.
 * @param {Record<string, unknown>} order
 * @param {string | null | undefined} branchName
 * @returns {string}
 */
export function buildOrderWhatsAppShareText(order, branchName) {
	if (!order) return '';
	const idPart = order.display_id ?? order.order_number ?? order.id;
	const header = idPart != null && idPart !== '' ? `Pedido ${idPart}` : 'Pedido';
	const lines = [String(header)];
	if (branchName) lines.push(`Local: ${branchName}`);
	lines.push(`Cliente: ${order.client_name || '—'}`);
	if (order.client_phone) lines.push(`Tel: ${order.client_phone}`);
	if (order.client_rut && String(order.client_rut).trim()) {
		lines.push(`Doc: ${String(order.client_rut).trim()}`);
	}
	lines.push(`Pago: ${getPaymentLabel(order)}`);
	const total = Number(order.total);
	if (Number.isFinite(total) && total > 0) {
		lines.push(`Total: $${total.toLocaleString('es-CL')}`);
	}
	const items = order.items;
	if (Array.isArray(items) && items.length > 0) {
		lines.push('Productos:');
		for (const it of items) {
			const qty = it.quantity ?? 1;
			const name = it.name ?? 'Ítem';
			lines.push(`• ${qty}x ${name}`);
		}
	}
	if (order.note && String(order.note).trim()) {
		lines.push(`Nota: ${String(order.note).trim()}`);
	}
	if (isOrderDelivery(order)) {
		const handoff =
			order.handoff_code != null && String(order.handoff_code).trim() !== ''
				? String(order.handoff_code).trim()
				: null;
		const fee = Number(order.delivery_fee);
		lines.push('');
		lines.push('— Envío —');
		if (handoff) {
			lines.push(`Código verificación (pedir al cliente): ${handoff}`);
		}
		if (Number.isFinite(fee) && fee > 0) {
			lines.push(`Cargo envío: $${fee.toLocaleString('es-CL')}`);
		}
		const addr = order.delivery_address;
		const addrLines = deliveryAddressLines(addr);
		if (addrLines.length > 0) {
			lines.push('Dirección:');
			for (const al of addrLines) {
				lines.push(al);
			}
		}
		const mapsUrl =
			addr && typeof addr === 'object' && !Array.isArray(addr) && addr.maps_url
				? String(addr.maps_url).trim()
				: '';
		if (mapsUrl) {
			lines.push(`Mapa: ${mapsUrl}`);
		}
	}
	return lines.join('\n');
}

/**
 * Texto listo para pegar al repartidor: dirección, mapa, contacto, código de verificación, totales.
 * @param {Record<string, unknown>} order
 * @param {string | null | undefined} branchName
 * @param {string | null | undefined} branchAddress Dirección del local (origen), opcional
 * @returns {string}
 */
export function buildOrderDeliveryDriverPack(order, branchName, branchAddress = null) {
	if (!order || !isOrderDelivery(order)) return '';
	const idPart = order.display_id ?? order.order_number ?? order.id;
	const lines = [];
	lines.push('ENTREGA A DOMICILIO');
	lines.push(`Pedido: ${idPart != null && idPart !== '' ? idPart : order.id}`);
	const handoff =
		order.handoff_code != null && String(order.handoff_code).trim() !== ''
			? String(order.handoff_code).trim()
			: null;
	if (handoff) {
		lines.push(`Código verificación (validar con el cliente): ${handoff}`);
	}
	if (branchName) {
		lines.push(`Local: ${branchName}`);
	}
	if (branchAddress && String(branchAddress).trim()) {
		lines.push(`Sale de: ${String(branchAddress).trim()}`);
	}
	lines.push('');
	lines.push('Dónde llevar');
	const addr = order.delivery_address;
	const addrLines = deliveryAddressLines(addr);
	if (addrLines.length > 0) {
		for (const al of addrLines) {
			lines.push(al);
		}
	} else {
		lines.push('(Sin dirección guardada en el pedido)');
	}
	const mapsUrl =
		addr && typeof addr === 'object' && !Array.isArray(addr) && addr.maps_url
			? String(addr.maps_url).trim()
			: '';
	if (mapsUrl) {
		lines.push('');
		lines.push(`Abrir en mapas: ${mapsUrl}`);
	}
	const lat =
		addr && typeof addr === 'object' && !Array.isArray(addr) && addr.lat != null
			? Number(addr.lat)
			: NaN;
	const lng =
		addr && typeof addr === 'object' && !Array.isArray(addr) && addr.lng != null
			? Number(addr.lng)
			: NaN;
	if (Number.isFinite(lat) && Number.isFinite(lng)) {
		lines.push(`Coordenadas: ${lat}, ${lng}`);
	}
	lines.push('');
	lines.push('Contacto');
	lines.push(`Nombre: ${order.client_name || '—'}`);
	if (order.client_phone) {
		const digits = String(order.client_phone).replace(/\D/g, '');
		lines.push(`Tel: ${order.client_phone}`);
		if (digits) {
			lines.push(`WhatsApp: https://wa.me/${digits}`);
		}
	}
	if (order.client_rut && String(order.client_rut).trim()) {
		lines.push(`Doc: ${String(order.client_rut).trim()}`);
	}
	lines.push('');
	lines.push('Pago y montos');
	lines.push(`Método: ${getPaymentLabel(order)}`);
	const fee = Number(order.delivery_fee);
	if (Number.isFinite(fee) && fee > 0) {
		lines.push(`Cargo envío: $${fee.toLocaleString('es-CL')}`);
	}
	const total = Number(order.total);
	if (Number.isFinite(total) && total > 0) {
		lines.push(`Total pedido: $${total.toLocaleString('es-CL')}`);
	}
	const items = order.items;
	if (Array.isArray(items) && items.length > 0) {
		lines.push('');
		lines.push('Qué lleva');
		for (const it of items) {
			const qty = it.quantity ?? 1;
			const name = it.name ?? 'Ítem';
			lines.push(`• ${qty}x ${name}`);
		}
	}
	if (order.note && String(order.note).trim()) {
		lines.push('');
		lines.push(`Nota: ${String(order.note).trim()}`);
	}
	return lines.join('\n');
}

/**
 * Slug de método de pago para CSS y desglose: 'cash' | 'card' | 'transfer'.
 * @param {{ payment_type?: string; payment_method_specific?: string | null }} order
 * @returns {'cash' | 'card' | 'transfer'}
 */
export function getPaymentSlug(order) {
	if (!order) return 'cash';
	if (order.payment_type === 'tarjeta' || order.payment_type === 'card') return 'card';
	if (isOnlineOrder(order)) return 'transfer';
	return 'cash';
}

/**
 * Objeto JSON persistido en orders.delivery_address para panel / tickets.
 * @param {{
 *   rawAddress?: unknown;
 *   deliveryReference?: unknown;
 *   namedAreaId?: string | null;
 *   namedAreaLabel?: string | null;
 * }} p
 * @returns {Record<string, unknown>}
 */
export function buildDeliveryAddressRecord(p) {
	const ref =
		typeof p.deliveryReference === 'string'
			? p.deliveryReference.replace(/<[^>]*>?/gm, '').trim()
			: '';
	const raw = p.rawAddress;
	if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
		const base = { ...(/** @type {Record<string, unknown>} */ (raw)) };
		const lineAddr =
			typeof base.address === 'string' ? base.address.trim() : '';
		if (ref) {
			base.reference = ref;
			base.street_detail = ref;
		}
		const nid =
			p.namedAreaId && String(p.namedAreaId).trim()
				? String(p.namedAreaId).trim()
				: typeof base.named_area_id === 'string'
					? base.named_area_id.trim()
					: '';
		const nlab =
			p.namedAreaLabel && String(p.namedAreaLabel).trim()
				? String(p.namedAreaLabel).trim()
				: typeof base.named_area_label === 'string'
					? base.named_area_label.trim()
					: '';
		if (nid) base.named_area_id = nid;
		if (nlab) base.named_area_label = nlab;

		const parts = [];
		if (nlab || base.named_area_label) {
			parts.push(`Zona: ${String(base.named_area_label ?? nlab ?? '').trim()}`);
		}
		if (lineAddr) parts.push(lineAddr);
		if (ref) parts.push(`Ref: ${ref}`);
		const formatted =
			parts.filter(Boolean).join(' · ') ||
			(typeof base.formatted_address === 'string' &&
			String(base.formatted_address).trim()
				? String(base.formatted_address).trim()
				: lineAddr || ref || 'Delivery');
		base.formatted_address =
			typeof base.formatted_address === 'string' && base.formatted_address.trim()
				? base.formatted_address.trim()
				: formatted;
		if (!base.address || !String(base.address).trim()) {
			base.address =
				lineAddr || base.formatted_address;
		}
		return base;
	}

	const lineAddr = typeof raw === 'string' ? raw.replace(/<[^>]*>?/gm, '').trim() : '';
	const nid =
		p.namedAreaId && String(p.namedAreaId).trim()
			? String(p.namedAreaId).trim()
			: '';
	const nlab =
		p.namedAreaLabel && String(p.namedAreaLabel).trim()
			? String(p.namedAreaLabel).trim()
			: '';

	const parts = [];
	if (nlab) parts.push(`Zona: ${nlab}`);
	if (lineAddr) parts.push(lineAddr);
	if (ref) parts.push(`Ref: ${ref}`);
	const formatted = parts.length > 0 ? parts.join(' · ') : lineAddr || nlab || ref || 'Delivery';

	/** @type {Record<string, unknown>} */
	const out = {
		formatted_address: formatted,
		address: lineAddr || formatted,
	};
	if (nid) out.named_area_id = nid;
	if (nlab) out.named_area_label = nlab;
	if (ref) {
		out.reference = ref;
		out.street_detail = ref;
	}
	return out;
}

/**
 * Una línea corta para Kanban (zona + referencia / dirección).
 * @param {Record<string, unknown> | null | undefined} order
 * @returns {string}
 */
export function orderDeliveryKanbanSubtitle(order) {
	if (!order) return '';
	const lines = deliveryAddressLines(order.delivery_address);
	if (lines.length === 0) return '';
	return lines.slice(0, 2).join(' · ');
}

/**
 * Pedido con envío a domicilio (tabla orders: order_type, delivery_address, delivery_fee).
 * @param {Record<string, unknown> | null | undefined} order
 * @returns {boolean}
 */
export function isOrderDelivery(order) {
	if (!order) return false;
	const ch = String(order.channel ?? '')
		.trim()
		.toLowerCase();
	if (ch === 'delivery') return true;

	const t = String(order.order_type ?? '')
		.trim()
		.toLowerCase();
	if (t === 'delivery' || t === 'envio' || t === 'envío' || t === 'despacho') {
		return true;
	}
	const fee = Number(order.delivery_fee);
	if (Number.isFinite(fee) && fee > 0) {
		return true;
	}
	const addr = order.delivery_address;
	if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
		const vals = Object.values(addr).filter(
			(v) => v != null && String(v).trim() !== '',
		);
		if (vals.length > 0) return true;
	}
	return false;
}

/**
 * Texto legible de delivery_address (JSONB).
 * @param {unknown} addr
 * @returns {string[]}
 */
export function deliveryAddressLines(addr) {
	if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return [];
	const o = /** @type {Record<string, unknown>} */ (addr);
	const prefer = [
		'named_area_label',
		'zone_label',
		'formatted_address',
		'label',
		'address',
		'street',
		'line1',
		'line_1',
		'description',
		'reference',
		'street_detail',
		'referencia',
		'comuna',
		'commune',
		'city',
		'ciudad',
	];
	const lines = [];
	for (const k of prefer) {
		if (o[k] != null && String(o[k]).trim() !== '') {
			lines.push(`${String(o[k]).trim()}`);
		}
	}
	if (lines.length > 0) return [...new Set(lines)];
	try {
		return [JSON.stringify(o, null, 2)];
	} catch {
		return [];
	}
}

/**
 * Saneamiento de pedidos desde la BD (items JSONB, total, client_*, status, etc.)
 * Usado en Admin y en hooks que parsean órdenes.
 */
/**
 * Abre WhatsApp con el mensaje listo para que quien envía elija al destinatario **dentro de WhatsApp**
 * (compartir nativo en móvil, o enlace sin número que abre la app / Web).
 *
 * @param {string} text
 * @param {{ onError?: (msg: string) => void }} [options]
 * @returns {Promise<boolean>}
 */
export async function shareDeliveryPackViaWhatsApp(text, options = {}) {
	const { onError } = options;
	const body = String(text ?? "").trim();
	if (!body) {
		onError?.("No hay datos de envío para enviar.");
		return false;
	}
	if (typeof window === "undefined") return false;

	try {
		if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
			await navigator.share({ text: body });
			return true;
		}
	} catch (err) {
		const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
		if (name === "AbortError") {
			return true;
		}
	}

	const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(body)}`;
	window.open(url, "_blank", "noopener,noreferrer");
	return true;
}

export function sanitizeOrder(rawOrder) {
	if (!rawOrder) return null;

	let cleanItems = [];
	if (rawOrder.items) {
		if (Array.isArray(rawOrder.items)) {
			cleanItems = rawOrder.items;
		} else if (typeof rawOrder.items === 'string') {
			try {
				const parsed = JSON.parse(rawOrder.items);
				cleanItems = Array.isArray(parsed) ? parsed : [];
			} catch {
				cleanItems = [];
			}
		}
	}

	return {
		...rawOrder,
		items: cleanItems,
		total: Number(rawOrder.total) || 0,
		delivery_fee: Number(rawOrder.delivery_fee) || 0,
		client_name: rawOrder.client_name || 'Cliente Desconocido',
		client_rut: rawOrder.client_rut || 'Sin RUT',
		client_phone: rawOrder.client_phone || '',
		status: rawOrder.status || 'pending',
		created_at: rawOrder.created_at || new Date().toISOString(),
		payment_type: rawOrder.payment_type || 'unknown',
		payment_method_specific: rawOrder.payment_method_specific ?? null
	};
}
