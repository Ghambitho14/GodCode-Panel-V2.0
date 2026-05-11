import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Truck, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase";
import {
	buildDefaultDeliveryPaymentKeys,
	computeDeliveryFee,
	effectiveDeliveryPricingMode,
	normalizeDeliverySettings,
} from "@/lib/delivery-settings";
import { branchSettingsService } from "@/modules/cash/services/branchSettingsService";
import "../styles/AdminMenuCarousel.css";
import "../styles/AdminMenuOptions.css";
import DeliveryPlaceSuggestInput from "./DeliveryPlaceSuggestInput";
import AdminHelpTip from "./AdminHelpTip";

const emptyDraft = () => ({
	pricePerKm: "",
	baseFee: "",
	minFee: "",
	maxFee: "",
	maxDeliveryKm: "",
	freeDeliveryFromSubtotal: "",
	minOrderSubtotal: "",
	customerNotes: "",
	trustedDriverWhatsApp: "",
	originLat: "",
	originLng: "",
	uberDirectStoreId: "",
	externalDeliveryDisplayText: "",
});

const emptyZoneRow = () => ({
	id: `z${Date.now()}`,
	radiusKm: "",
	feeFlat: "",
});

const emptyNamedPlaceRow = () => ({
	id: `p${Date.now()}`,
	name: "",
	feeFlat: "",
	aliasesStr: "",
});

const DELIVERY_PAYMENT_LABELS = {
	tienda: "Efectivo al recibir",
	tarjeta: "Tarjeta",
	paypal: "PayPal",
	stripe: "Stripe",
	pago_movil: "Pago móvil",
	zelle: "Zelle",
	transferencia_bancaria: "Transferencia",
};

/** Textos de ayuda al pasar el cursor (title) y para lectores de pantalla */
const DELIVERY_TOOLTIPS = {
	removeDistanceRing:
		"Quita este anillo: si el pedido llega dentro del radio (km) desde el local, aplicas la tarifa fija de la fila. Si no entra en ningún anillo, se usa precio por km + cargo base. Si solo queda una fila, no se borra (evita lista vacía).",
	removeNamedZoneRow:
		"Quita esta zona: nombre en el checkout, tarifa de envío y alias opcionales. Debe quedar al menos una fila. No borra datos guardados hasta que pulses Guardar.",
	addDistanceRing:
		"Añade otro anillo: ordena por radio del más pequeño al más grande; el primero que cubra la distancia gana.",
	addNamedZone:
		"Añade otra zona con nombre, tarifa y alias (opcional). Máximo 40 filas.",
	headerSwitch:
		"Activa o desactiva el envío a domicilio para esta sucursal. Si está apagado, el cliente solo puede retirar o consumir en local; el resto de opciones queda bloqueado.",
	strategyIntro:
		"Elige una sola modalidad: por distancia, por zonas con nombre o Uber Direct / consultar con tienda (cotización opcional vía API).",
	strategyDistance:
		"Cobro por distancia en línea recta desde el local: precio por km, cargo base opcional y anillos con tarifa fija por radio.",
	strategyNamedAreas:
		"Cada zona (comuna, barrio…) tiene un precio de envío fijo; no se suma precio por km ni cargo base de la otra modalidad.",
	strategyExternal:
		"Uber Direct: con Store ID (esta sucursal) y credenciales OAuth a nivel empresa, el menú puede cotizar envío en tiempo real. Si desactivas “Mostrar monto”, el cliente solo ve texto. Client ID/Secret los configura GodCode en admin SaaS (Global de la empresa), no aquí.",
	uberStoreId:
		"Identificador del local de recogida en Uber para esta sucursal (no es el Client ID OAuth). Lo obtienes en el portal de Uber.",
	uberShowFee:
		"Activo: el cliente ve precio estimado de envío en el carrito. Apagado: solo texto informativo sin monto.",
	uberDisplayText:
		"Mensaje en checkout cuando no hay monto de envío o como texto de apoyo.",
	namedManual:
		"El cliente elige la zona en una lista al pagar. Útil cuando quieres nombres exactos y control total.",
	namedAddress:
		"El cliente escribe su dirección; el sistema intenta asignar zona y precio automáticamente (datos de mapa abiertos).",
	zonesCheckoutSection:
		"Define cómo el cliente indica su zona en el checkout: lista para elegir o detección automática desde la dirección escrita.",
	pricePerKm:
		"Se multiplica por los kilómetros de distancia cuando ningún anillo cubre el pedido (modalidad por distancia).",
	baseFee:
		"Suma fija que se añade al costo por km antes de aplicar mínimos, máximos o envío gratis por subtotal.",
	originLat:
		"Latitud del local para calcular distancia al cliente (modalidad por km). Formato decimal, ej. -33.4489.",
	originLng:
		"Longitud del local para calcular distancia al cliente (modalidad por km). Formato decimal, ej. -70.6693.",
	saveButton:
		"Guarda tarifas, zonas, métodos de pago permitidos en delivery, WhatsApp del repartidor y opciones avanzadas en el servidor.",
	preview:
		"Ejemplo de envío con valores actuales (distancia o primera zona y subtotal de ejemplo).",
	driverWhatsApp:
		"Número al que el equipo puede enviar el mensaje de envío desde el tablero (WhatsApp abre en la app; tú eliges el contacto).",
	minFee:
		"Piso del costo de envío si el cálculo quedara por debajo (opcional).",
	maxFee:
		"Tope máximo del costo de envío aunque el cálculo sea mayor (opcional).",
	maxDeliveryKm:
		"No se aceptan pedidos de delivery si la distancia supera este valor (modalidad por km).",
	freeDeliveryFromSubtotal:
		"Si el subtotal del carrito alcanza este monto, el envío sale $0 (salvo que otra regla lo impida).",
	minOrderSubtotal:
		"Subtotal mínimo para permitir un pedido con delivery.",
	customerNotes:
		"Texto breve que ve el cliente en el checkout de envío (tiempos, condiciones, etc.).",
	originLatNamed:
		"Opcional: ayuda a ordenar sugerencias al escribir nombres de zona (modalidad por zonas con nombre).",
	originLngNamed:
		"Opcional: junto con la latitud, mejora sugerencias de lugares cercanos al local.",
	paymentSection:
		"Restringe qué medios de pago puede elegir el cliente solo cuando el pedido es delivery.",
	distanceRingsHelp:
		"Opcional: si el pedido entra dentro del radio (km) desde el local, aplicas la tarifa fija de esa fila; si no encaja en ningún anillo, se usa precio por km + cargo base.",
	zoneRingRadius:
		"Distancia máxima en km desde el local: si el pedido cae dentro de este radio, se aplica la tarifa fija de la misma fila.",
	zoneRingFee:
		"Precio de envío completo cuando la distancia entra en este anillo (no se suma precio por km ni cargo base de otras filas).",
	namedZoneName:
		"Nombre que verá el cliente o que se intentará casar con la dirección, según el modo de checkout.",
	namedZoneFee: "Costo de envío fijo para esta zona (modalidad por zonas con nombre).",
	namedZoneAliases:
		"Sinónimos separados por coma para reconocer la misma zona (ej. abreviaturas o barrios cercanos).",
};

/** Tooltips por chip de método de pago (delivery) */
const DELIVERY_PAYMENT_CHIP_TITLE = {
	tienda: "Permite pagar en efectivo al recibir el pedido en domicilio.",
	tarjeta: "Permite tarjeta al recibir o según tu configuración de métodos de pago.",
	paypal: "Permite PayPal en checkout si lo tienes activo en la sucursal.",
	stripe: "Permite Stripe en checkout si lo tienes activo en la sucursal.",
	pago_movil: "Permite pago móvil si lo tienes configurado en métodos de pago.",
	zelle: "Permite Zelle si lo tienes configurado en métodos de pago.",
	transferencia_bancaria: "Permite transferencia bancaria si la tienes activa en la sucursal.",
};

/**
 * Lee y escribe `branches.delivery_settings` (JSONB) para la sucursal seleccionada.
 */
export default function AdminMenuDeliverySection({ showNotify, selectedBranch, onSaved }) {
	const branchId =
		selectedBranch?.id && selectedBranch.id !== "all" ? selectedBranch.id : null;

	const [deliveryEnabled, setDeliveryEnabled] = useState(true);
	const [draft, setDraft] = useState(emptyDraft);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savingFields, setSavingFields] = useState(false);
	const [zoneRows, setZoneRows] = useState(() => [emptyZoneRow()]);
	const [namedPlaceRows, setNamedPlaceRows] = useState(() => [emptyNamedPlaceRow()]);
	const [pricingStrategy, setPricingStrategy] = useState("distance");
	const [namedAreaResolution, setNamedAreaResolution] = useState("manual_select");
	const [showExternalDeliveryFee, setShowExternalDeliveryFee] = useState(true);
	/** Viene del SaaS (`companies.integration_settings.allowTenantExternalDelivery`). */
	const [allowTenantExternalDelivery, setAllowTenantExternalDelivery] = useState(true);
	/** `true` = permitido para delivery (clave = id de método) */
	const [deliveryPaymentChecked, setDeliveryPaymentChecked] = useState({});
	const deliveryPaymentCheckedRef = useRef({});

	const applyServerPayload = useCallback((data) => {
		const n = normalizeDeliverySettings(data);
		setDeliveryEnabled(n.enabled !== false);
		setDraft({
			pricePerKm: String(n.pricePerKm ?? ""),
			baseFee: String(n.baseFee ?? ""),
			minFee: n.minFee != null ? String(n.minFee) : "",
			maxFee: n.maxFee != null ? String(n.maxFee) : "",
			maxDeliveryKm: n.maxDeliveryKm != null ? String(n.maxDeliveryKm) : "",
			freeDeliveryFromSubtotal:
				n.freeDeliveryFromSubtotal != null ? String(n.freeDeliveryFromSubtotal) : "",
			minOrderSubtotal: n.minOrderSubtotal != null ? String(n.minOrderSubtotal) : "",
			customerNotes: n.customerNotes ?? "",
			trustedDriverWhatsApp:
				typeof data.trustedDriverWhatsApp === "string"
					? data.trustedDriverWhatsApp
					: "",
			originLat:
				data.originLat != null && data.originLat !== ""
					? String(data.originLat)
					: "",
			originLng:
				data.originLng != null && data.originLng !== ""
					? String(data.originLng)
					: "",
			uberDirectStoreId:
				typeof data.uberDirectStoreId === "string" ? data.uberDirectStoreId : "",
			externalDeliveryDisplayText:
				typeof data.externalDeliveryDisplayText === "string"
					? data.externalDeliveryDisplayText
					: "",
		});
		setShowExternalDeliveryFee(data.showExternalDeliveryFeeAmount !== false);
		const z = Array.isArray(n.zones) && n.zones.length > 0
			? n.zones.map((row) => ({
					id: row.id,
					radiusKm: String(row.radiusKm),
					feeFlat: String(row.feeFlat),
				}))
			: [emptyZoneRow()];
		setZoneRows(z);
		const allowExt = data.allowTenantExternalDelivery !== false;
		setAllowTenantExternalDelivery(allowExt);
		const rawStrat =
			n.deliveryPricingStrategy === "named_areas"
				? "named_areas"
				: n.deliveryPricingStrategy === "external"
					? "external"
					: "distance";
		const strat = rawStrat === "external" && !allowExt ? "distance" : rawStrat;
		setPricingStrategy(strat);
		if (rawStrat === "external" && !allowExt) {
			showNotify(
				"Esta sucursal tenía envío externo, pero tu administrador lo desactivó en el panel SaaS. Elige una modalidad y guarda para alinear el menú.",
				"warning",
			);
		}
		setNamedAreaResolution(
			n.namedAreaResolution === "address_matched" ? "address_matched" : "manual_select",
		);
		const na =
			Array.isArray(n.namedAreas) && n.namedAreas.length > 0
				? n.namedAreas.map((row) => ({
						id: row.id,
						name: String(row.name ?? ""),
						feeFlat: String(row.feeFlat),
						aliasesStr: Array.isArray(row.aliases) ? row.aliases.join(", ") : "",
					}))
				: [emptyNamedPlaceRow()];
		setNamedPlaceRows(na);

		const allPayKeys = buildDefaultDeliveryPaymentKeys(selectedBranch?.payment_methods);
		const allowedRaw = data.allowedPaymentMethodsForDelivery;
		if (Array.isArray(allowedRaw) && allowedRaw.length > 0) {
			const allowedSet = new Set(
				allowedRaw.map((x) => String(x).trim().toLowerCase()),
			);
			const next = Object.fromEntries(allPayKeys.map((k) => [k, allowedSet.has(k)]));
			deliveryPaymentCheckedRef.current = next;
			setDeliveryPaymentChecked(next);
		} else {
			const next = Object.fromEntries(allPayKeys.map((k) => [k, true]));
			deliveryPaymentCheckedRef.current = next;
			setDeliveryPaymentChecked(next);
		}
	}, [selectedBranch?.payment_methods, showNotify]);

	const load = useCallback(async () => {
		if (!branchId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const data = await branchSettingsService.getDeliverySettings(branchId);
			if (!data) throw new Error("Sucursal no encontrada");
			applyServerPayload(data);
		} catch (e) {
			showNotify(e instanceof Error ? e.message : "Error al cargar delivery", "error");
			setDeliveryEnabled(true);
			setDraft(emptyDraft());
		} finally {
			setLoading(false);
		}
	}, [branchId, showNotify, applyServerPayload]);

	useEffect(() => {
		void load();
	}, [load]);

	// Realtime: si otro usuario cambia `branches.delivery_settings` de esta sucursal,
	// refrescamos el panel de Opciones de menú sin recargar la página.
	useEffect(() => {
		if (!branchId) return;
		const channel = supabase
			.channel(`branch-delivery-settings-${branchId}`)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "branches", filter: `id=eq.${branchId}` },
				() => {
					void load();
				},
			)
			.subscribe();
		return () => {
			try {
				supabase.removeChannel(channel);
			} catch {}
		};
	}, [branchId, load]);

	const zonesPayload = useMemo(() => {
		const out = [];
		for (const row of zoneRows) {
			const r = Number(String(row.radiusKm).replace(",", "."));
			const f = Number(String(row.feeFlat).replace(",", "."));
			if (!Number.isFinite(r) || r <= 0) continue;
			if (!Number.isFinite(f) || f < 0) continue;
			out.push({
				id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `z${out.length}`,
				radiusKm: r,
				feeFlat: f,
			});
		}
		return out;
	}, [zoneRows]);

	const namedPlacesPayload = useMemo(() => {
		const out = [];
		for (const row of namedPlaceRows) {
			const nm = String(row.name ?? "").trim();
			const f = Number(String(row.feeFlat).replace(",", "."));
			if (!nm) continue;
			if (!Number.isFinite(f) || f < 0) continue;
			const aliasesStr = String(row.aliasesStr ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, 8);
			const o = {
				id:
					typeof row.id === "string" && row.id.trim()
						? row.id.trim()
						: `p${out.length}`,
				name: nm.slice(0, 120),
				feeFlat: f,
			};
			if (aliasesStr.length > 0) o.aliases = aliasesStr;
			out.push(o);
		}
		return out;
	}, [namedPlaceRows]);

	const normalizedFromDraft = useMemo(() => {
		return normalizeDeliverySettings({
			enabled: deliveryEnabled,
			deliveryPricingStrategy: pricingStrategy,
			externalDeliveryProvider: pricingStrategy === "external" ? "uber_direct" : null,
			uberDirectStoreId: draft.uberDirectStoreId,
			showExternalDeliveryFeeAmount: showExternalDeliveryFee,
			externalDeliveryDisplayText: draft.externalDeliveryDisplayText,
			namedAreaResolution,
			pricePerKm: draft.pricePerKm === "" ? 0 : Number(draft.pricePerKm),
			baseFee: draft.baseFee === "" ? 0 : Number(draft.baseFee),
			minFee: draft.minFee === "" ? null : Number(draft.minFee),
			maxFee: draft.maxFee === "" ? null : Number(draft.maxFee),
			maxDeliveryKm: draft.maxDeliveryKm === "" ? null : Number(draft.maxDeliveryKm),
			freeDeliveryFromSubtotal:
				draft.freeDeliveryFromSubtotal === "" ? null : Number(draft.freeDeliveryFromSubtotal),
			minOrderSubtotal: draft.minOrderSubtotal === "" ? null : Number(draft.minOrderSubtotal),
			customerNotes: draft.customerNotes,
			zones: zonesPayload,
			namedAreas: namedPlacesPayload,
		});
	}, [
		deliveryEnabled,
		pricingStrategy,
		namedAreaResolution,
		draft,
		zonesPayload,
		namedPlacesPayload,
		showExternalDeliveryFee,
	]);

	const deliveryPaymentKeys = useMemo(
		() => buildDefaultDeliveryPaymentKeys(selectedBranch?.payment_methods),
		[selectedBranch?.payment_methods, selectedBranch?.id],
	);

	const previewFee = useMemo(() => {
		const exKm = 3;
		const exSubtotal = 15000;
		if (normalizedFromDraft.deliveryPricingStrategy === "external") {
			return computeDeliveryFee(normalizedFromDraft, 0, exSubtotal);
		}
		const areas = normalizedFromDraft.namedAreas;
		if (effectiveDeliveryPricingMode(normalizedFromDraft) === "named" && areas.length > 0) {
			return computeDeliveryFee(normalizedFromDraft, 0, exSubtotal, {
				namedAreaId: areas[0].id,
			});
		}
		return computeDeliveryFee(normalizedFromDraft, exKm, exSubtotal);
	}, [normalizedFromDraft]);

	const toggle = async (next) => {
		if (!branchId) return;
		setSaving(true);
		try {
			const data = await branchSettingsService.saveDeliverySettings(branchId, { enabled: next });
			setDeliveryEnabled(data.enabled !== false);
			showNotify(next ? "Delivery activado para esta sucursal." : "Delivery desactivado para esta sucursal.");
			if (typeof onSaved === "function") {
				onSaved();
			}
		} catch (e) {
			showNotify(e instanceof Error ? e.message : "Error al guardar", "error");
			void load();
		} finally {
			setSaving(false);
		}
	};

	const saveTariffs = async () => {
		if (!branchId) return;
		if (!deliveryEnabled) {
			showNotify("Activa delivery para guardar tarifas y opciones.", "error");
			return;
		}
		setSavingFields(true);
		try {
			const payload = {
				branchId,
				deliveryPricingStrategy: pricingStrategy,
				namedAreaResolution,
				pricePerKm:
					draft.pricePerKm === "" ? 0 : Math.max(0, Number(draft.pricePerKm) || 0),
				baseFee: draft.baseFee === "" ? 0 : Math.max(0, Number(draft.baseFee) || 0),
				minFee: draft.minFee === "" ? null : Number(draft.minFee),
				maxFee: draft.maxFee === "" ? null : Number(draft.maxFee),
				maxDeliveryKm: draft.maxDeliveryKm === "" ? null : Number(draft.maxDeliveryKm),
				freeDeliveryFromSubtotal:
					draft.freeDeliveryFromSubtotal === ""
						? null
						: Number(draft.freeDeliveryFromSubtotal),
				minOrderSubtotal: draft.minOrderSubtotal === "" ? null : Number(draft.minOrderSubtotal),
				customerNotes: draft.customerNotes.trim(),
				trustedDriverWhatsApp: draft.trustedDriverWhatsApp.trim(),
				zones: zonesPayload,
				namedAreas: namedPlacesPayload,
			};
			const olat = draft.originLat.trim();
			const olng = draft.originLng.trim();
			payload.originLat = olat === "" ? null : Number(olat);
			payload.originLng = olng === "" ? null : Number(olng);
			if (olat !== "" && !Number.isFinite(payload.originLat)) {
				delete payload.originLat;
			}
			if (olng !== "" && !Number.isFinite(payload.originLng)) {
				delete payload.originLng;
			}
			const payKeys = buildDefaultDeliveryPaymentKeys(selectedBranch?.payment_methods);
			// Usar ref para evitar estado "stale" si el usuario toca chip y guarda muy rápido.
			const checked = deliveryPaymentCheckedRef.current || {};
			const selectedPay = payKeys.filter((k) => checked[k] !== false);
			if (selectedPay.length === 0) {
				showNotify(
					"Selecciona al menos un método de pago permitido para delivery.",
					"error",
				);
				return;
			}
			if (selectedPay.length === payKeys.length) {
				payload.allowedPaymentMethodsForDelivery = null;
			} else {
				payload.allowedPaymentMethodsForDelivery = selectedPay;
			}
			payload.externalDeliveryProvider =
				pricingStrategy === "external" ? "uber_direct" : null;
			payload.uberDirectStoreId =
				pricingStrategy === "external" && draft.uberDirectStoreId.trim()
					? draft.uberDirectStoreId.trim().slice(0, 128)
					: null;
			payload.showExternalDeliveryFeeAmount =
				pricingStrategy === "external" ? showExternalDeliveryFee : true;
			if (pricingStrategy === "external") {
				payload.externalDeliveryDisplayText =
					draft.externalDeliveryDisplayText.trim().slice(0, 500) || null;
			} else {
				payload.externalDeliveryDisplayText = null;
			}
			const data = await branchSettingsService.saveDeliverySettings(branchId, payload);
			applyServerPayload(data);
			showNotify("Tarifas y opciones de delivery guardadas.");
			if (typeof onSaved === "function") {
				onSaved();
			}
		} catch (e) {
			showNotify(e instanceof Error ? e.message : "Error al guardar", "error");
			void load();
		} finally {
			setSavingFields(false);
		}
	};

	if (!branchId) {
		return (
			<section className="glass animate-fade admin-menu-options-card admin-menu-options-delivery">
				<p className="admin-menu-options-card-desc" style={{ margin: 0 }}>
					Selecciona una <strong style={{ color: "white" }}>sucursal</strong> en el encabezado para
					configurar <strong>delivery</strong> y tarifas por kilómetro en esa fila de{" "}
					<strong>branches.delivery_settings</strong>.
				</p>
			</section>
		);
	}

	const branchLabel = selectedBranch?.name ? ` · ${selectedBranch.name}` : "";
	const lockOptions = !deliveryEnabled || loading || savingFields || saving;

	const previewText =
		normalizedFromDraft.deliveryPricingStrategy === "external"
			? previewFee.fee === -2
				? "Ejemplo no aplicable: subtotal inferior al pedido mínimo."
				: previewFee.waivedFreeShipping
					? "Modalidad externa: el cliente no ve precio de envío (solo “Consultar con la tienda” o tu mensaje). En el ejemplo, umbral de envío gratis podría aplicar al total sin mostrar monto de delivery."
					: normalizedFromDraft.showExternalDeliveryFeeAmount
						? "Uber Direct: con Store ID y credenciales de empresa, el menú cotiza el envío y muestra monto al cliente (requiere ubicación en el mapa)."
						: "Uber Direct / externo: el cliente solo ve texto (sin monto de envío en checkout), p. ej. “Consultar con la tienda”."
			: previewFee.fee < 0
				? previewFee.fee === -1
					? "Ejemplo no aplicable: distancia fuera del máximo configurado."
					: previewFee.fee === -2
						? "Ejemplo no aplicable: subtotal inferior al pedido mínimo."
						: "Ejemplo no aplicable."
				: effectiveDeliveryPricingMode(normalizedFromDraft) === "named" &&
					  normalizedFromDraft.namedAreas?.length > 0
					? previewFee.waivedFreeShipping
						? "Ejemplo (primera zona, subtotal $15.000): envío gratuito por umbral."
						: `Ejemplo (primera zona, subtotal $15.000): envío ≈ $${Math.round(previewFee.fee).toLocaleString("es-CL")}.`
					: previewFee.waivedFreeShipping
						? "Ejemplo (3 km, subtotal $15.000): envío gratuito por umbral."
						: `Ejemplo (3 km, subtotal $15.000): envío ≈ $${Math.round(previewFee.fee).toLocaleString("es-CL")}.`;

	return (
		<section
			className="glass animate-fade admin-menu-options-card admin-menu-options-delivery"
			aria-labelledby="admin-menu-delivery-heading"
		>
			<div className="admin-menu-options-card-head admin-menu-options-card-head--delivery">
				<div className="admin-menu-options-card-head__main">
					<div className="admin-menu-options-card-icon" aria-hidden>
						<Truck size={20} />
					</div>
					<div>
						<h3 id="admin-menu-delivery-heading" className="admin-menu-options-card-title">
							Delivery{branchLabel}
						</h3>
						<p className="admin-menu-options-card-desc">
							Activa el envío y elige <strong>una forma de cobrar</strong>: por distancia, por zonas con
							nombre (comunas/barrios) o <strong>consultar / Uber Direct</strong>. En modo externo puedes
							activar cotización en vivo con Uber (Store ID por sucursal + credenciales OAuth configuradas
							por GodCode a nivel empresa). La tarifa por zona es el envío completo de esa zona (no se suma
							el cargo fijo ni el precio por km de la modalidad por distancia).
						</p>
					</div>
				</div>
				<div className="admin-menu-options-delivery-head-toggle">
					<div className="admin-menu-options-delivery-head-toggle__text">
						<span className="admin-menu-options-delivery-head-toggle__label">
							Delivery permitido
							<AdminHelpTip text={DELIVERY_TOOLTIPS.headerSwitch} />
						</span>
						<span className="admin-menu-options-delivery-hint">
							{loading
								? "Cargando…"
								: deliveryEnabled
									? "Envío a domicilio activo para esta sucursal."
									: "Solo retiro o consumo en local; las opciones de abajo están desactivadas."}
						</span>
					</div>
					<button
						type="button"
						className={`menu-carousel-switch ${deliveryEnabled ? "is-on" : ""}`}
						role="switch"
						aria-checked={deliveryEnabled}
						disabled={loading || saving}
						aria-label={deliveryEnabled ? "Desactivar delivery" : "Activar delivery"}
						onClick={() => void toggle(!deliveryEnabled)}
					>
						<span className="menu-carousel-switch-knob" />
					</button>
				</div>
			</div>

			{!loading ? (
				<div
					className={
						lockOptions
							? "admin-delivery-options-stack admin-delivery-options-stack--locked"
							: "admin-delivery-options-stack"
					}
					aria-disabled={lockOptions}
				>
					<details className="admin-delivery-fold">
						<summary className="admin-delivery-fold__summary">
							<div className="admin-delivery-fold__summary-text">
								<span className="admin-delivery-fold__eyebrow">Cobro</span>
								<span className="admin-delivery-fold__title">Tarifas de envío</span>
							</div>
						</summary>
						<div className="admin-delivery-fold__body">
					<div className="admin-delivery-strategy-block" style={{ marginTop: 0 }}>
						<p
							className="admin-menu-options-section-label admin-menu-options-section-label--with-tip"
							style={{ marginBottom: 8 }}
						>
							¿Cómo cobras el envío?
							<AdminHelpTip text={DELIVERY_TOOLTIPS.strategyIntro} />
						</p>
						<div className="admin-delivery-strategy-pills">
							<button
								type="button"
								disabled={lockOptions}
								className={`btn btn-secondary admin-tooltip-btn-hover ${pricingStrategy === "distance" ? "is-active" : ""}`}
								onClick={() => setPricingStrategy("distance")}
							>
								Por distancia (km)
								<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
									{DELIVERY_TOOLTIPS.strategyDistance}
								</span>
							</button>
							<button
								type="button"
								disabled={lockOptions}
								className={`btn btn-secondary admin-tooltip-btn-hover ${pricingStrategy === "named_areas" ? "is-active" : ""}`}
								onClick={() => setPricingStrategy("named_areas")}
							>
								Por zonas con nombre
								<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
									{DELIVERY_TOOLTIPS.strategyNamedAreas}
								</span>
							</button>
							{allowTenantExternalDelivery ? (
								<button
									type="button"
									disabled={lockOptions}
									className={`btn btn-secondary admin-tooltip-btn-hover ${pricingStrategy === "external" ? "is-active" : ""}`}
									onClick={() => setPricingStrategy("external")}
								>
									Consultar con tienda / externo
									<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
										{DELIVERY_TOOLTIPS.strategyExternal}
									</span>
								</button>
							) : null}
						</div>
					</div>

					{pricingStrategy === "distance" ? (
						<>
							<div className="admin-branch-delivery-grid" style={{ marginTop: 18 }}>
								<div className="form-group">
									<label htmlFor="adm-del-price-km">
										Precio por km
										<AdminHelpTip text={DELIVERY_TOOLTIPS.pricePerKm} />
									</label>
									<input
										id="adm-del-price-km"
										type="number"
										min={0}
										step="any"
										className="form-input"
										disabled={lockOptions}
										value={draft.pricePerKm}
										onChange={(ev) =>
											setDraft((d) => ({ ...d, pricePerKm: ev.target.value }))
										}
									/>
								</div>
								<div className="form-group">
									<label htmlFor="adm-del-base">
										Cargo fijo base
										<AdminHelpTip text={DELIVERY_TOOLTIPS.baseFee} />
									</label>
									<input
										id="adm-del-base"
										type="number"
										min={0}
										step="any"
										className="form-input"
										disabled={lockOptions}
										value={draft.baseFee}
										onChange={(ev) =>
											setDraft((d) => ({ ...d, baseFee: ev.target.value }))
										}
									/>
								</div>
								<div className="form-group">
									<label htmlFor="adm-del-olat">
										Ubicación del local · latitud
										<AdminHelpTip text={DELIVERY_TOOLTIPS.originLat} />
									</label>
									<input
										id="adm-del-olat"
										type="text"
										inputMode="decimal"
										className="form-input"
										placeholder="Ej: -33.4489"
										disabled={lockOptions}
										value={draft.originLat}
										onChange={(ev) =>
											setDraft((d) => ({ ...d, originLat: ev.target.value }))
										}
									/>
								</div>
								<div className="form-group">
									<label htmlFor="adm-del-olng">
										Ubicación del local · longitud
										<AdminHelpTip text={DELIVERY_TOOLTIPS.originLng} />
									</label>
									<input
										id="adm-del-olng"
										type="text"
										inputMode="decimal"
										className="form-input"
										placeholder="Ej: -70.6693"
										disabled={lockOptions}
										value={draft.originLng}
										onChange={(ev) =>
											setDraft((d) => ({ ...d, originLng: ev.target.value }))
										}
									/>
								</div>
							</div>
							<div className="admin-branch-delivery-zones" style={{ marginTop: 8 }}>
								<p
									className="admin-menu-options-card-desc admin-delivery-inline-tip"
									style={{ marginBottom: 10 }}
								>
									<strong>Anillos por distancia (opcional):</strong> si el pedido cae dentro del radio
									en km desde el local, aplicas la tarifa fija de esa fila; si no, se usa precio por km
									+ cargo fijo.{" "}
									<AdminHelpTip text={DELIVERY_TOOLTIPS.distanceRingsHelp} />
								</p>
								{zoneRows.map((row, idx) => (
									<div
										key={row.id}
										style={{
											display: "flex",
											flexWrap: "wrap",
											gap: 10,
											alignItems: "flex-end",
											marginBottom: 10,
										}}
									>
										<div className="form-group" style={{ flex: "1 1 120px" }}>
											<label htmlFor={`adm-del-zr-${row.id}`}>
												Radio máx. (km)
												<AdminHelpTip text={DELIVERY_TOOLTIPS.zoneRingRadius} />
											</label>
											<input
												id={`adm-del-zr-${row.id}`}
												type="number"
												min={0}
												step="any"
												className="form-input"
												disabled={lockOptions}
												value={row.radiusKm}
												onChange={(ev) => {
													const v = ev.target.value;
													setZoneRows((rows) =>
														rows.map((r, i) => (i === idx ? { ...r, radiusKm: v } : r)),
													);
												}}
											/>
										</div>
										<div className="form-group" style={{ flex: "1 1 120px" }}>
											<label htmlFor={`adm-del-zf-${row.id}`}>
												Tarifa fija ($)
												<AdminHelpTip text={DELIVERY_TOOLTIPS.zoneRingFee} />
											</label>
											<input
												id={`adm-del-zf-${row.id}`}
												type="number"
												min={0}
												step="any"
												className="form-input"
												disabled={lockOptions}
												value={row.feeFlat}
												onChange={(ev) => {
													const v = ev.target.value;
													setZoneRows((rows) =>
														rows.map((r, i) => (i === idx ? { ...r, feeFlat: v } : r)),
													);
												}}
											/>
										</div>
										<button
											type="button"
											className="admin-delivery-icon-btn admin-tooltip-btn-hover"
											disabled={lockOptions}
											aria-label="Quitar anillo de distancia (radio km y tarifa fija)"
											onClick={() =>
												setZoneRows((rows) =>
													rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx),
												)
											}
										>
											<Trash2 size={16} strokeWidth={1.75} aria-hidden />
											<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
												{DELIVERY_TOOLTIPS.removeDistanceRing}
											</span>
										</button>
									</div>
								))}
								<button
									type="button"
									className="btn btn-secondary admin-tooltip-btn-hover"
									style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
									disabled={lockOptions}
									onClick={() =>
										setZoneRows((rows) => [
											...rows,
											{ id: `z${Date.now()}`, radiusKm: "", feeFlat: "" },
										])
									}
								>
									<Plus size={16} strokeWidth={1.75} aria-hidden /> Añadir anillo
									<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
										{DELIVERY_TOOLTIPS.addDistanceRing}
									</span>
								</button>
							</div>
						</>
					) : pricingStrategy === "named_areas" ? (
						<>
							<div className="admin-delivery-strategy-block" style={{ marginTop: 14 }}>
								<p
									className="admin-menu-options-section-label admin-menu-options-section-label--with-tip"
									style={{ marginBottom: 8 }}
								>
									Zonas en el checkout
									<AdminHelpTip text={DELIVERY_TOOLTIPS.zonesCheckoutSection} />
								</p>
								<div className="admin-delivery-strategy-pills">
									<button
										type="button"
										disabled={lockOptions}
										className={`btn btn-secondary admin-tooltip-btn-hover ${namedAreaResolution === "manual_select" ? "is-active" : ""}`}
										onClick={() => setNamedAreaResolution("manual_select")}
									>
										Lista para elegir
										<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
											{DELIVERY_TOOLTIPS.namedManual}
										</span>
									</button>
									<button
										type="button"
										disabled={lockOptions}
										className={`btn btn-secondary admin-tooltip-btn-hover ${namedAreaResolution === "address_matched" ? "is-active" : ""}`}
										onClick={() => setNamedAreaResolution("address_matched")}
									>
										Según la dirección (automático)
										<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
											{DELIVERY_TOOLTIPS.namedAddress}
										</span>
									</button>
								</div>
								<p className="admin-menu-options-card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
									{namedAreaResolution === "manual_select"
										? "El cliente elige comuna/zona en un menú. Puedes usar sugerencias al escribir el nombre (mapa gratuito)."
										: "El cliente escribe la dirección; el sistema intenta detectar la zona y el precio (datos de mapa abiertos)."}
								</p>
							</div>
							<div className="admin-branch-delivery-zones" style={{ marginTop: 14 }}>
								<p className="admin-menu-options-card-desc" style={{ marginBottom: 10 }}>
									<strong>Zonas y tarifas</strong> (hasta 40). Cada fila es el envío completo para esa
									zona. Sugerencias de nombres vía{" "}
									<a
										href="https://www.openstreetmap.org/copyright"
										target="_blank"
										rel="noreferrer"
										style={{ color: "inherit", textDecoration: "underline" }}
									>
										OpenStreetMap
									</a>
									.
								</p>
								{namedPlaceRows.map((row, idx) => (
									<div
										key={row.id}
										style={{
											display: "flex",
											flexWrap: "wrap",
											gap: 10,
											alignItems: "flex-end",
											marginBottom: 10,
										}}
									>
										<div className="form-group" style={{ flex: "2 1 160px" }}>
											<label htmlFor={`adm-del-place-${row.id}`}>
												Nombre de la zona
												<AdminHelpTip text={DELIVERY_TOOLTIPS.namedZoneName} />
											</label>
											<DeliveryPlaceSuggestInput
												id={`adm-del-place-${row.id}`}
												placeholder="Comuna, barrio o sector"
												value={row.name}
												region={
													String(selectedBranch?.country ?? "CL").toUpperCase() === "VE"
														? "ve"
														: "cl"
												}
												biasLat={
													draft.originLat.trim() !== "" &&
													Number.isFinite(Number(draft.originLat))
														? Number(draft.originLat)
														: undefined
												}
												biasLng={
													draft.originLng.trim() !== "" &&
													Number.isFinite(Number(draft.originLng))
														? Number(draft.originLng)
														: undefined
												}
												disabled={lockOptions}
												onChange={(v) => {
													setNamedPlaceRows((rows) =>
														rows.map((r, i) => (i === idx ? { ...r, name: v } : r)),
													);
												}}
											/>
										</div>
										<div className="form-group" style={{ flex: "1 1 120px" }}>
											<label htmlFor={`adm-del-place-fee-${row.id}`}>
												Tarifa ($)
												<AdminHelpTip text={DELIVERY_TOOLTIPS.namedZoneFee} />
											</label>
											<input
												id={`adm-del-place-fee-${row.id}`}
												type="number"
												min={0}
												step="any"
												className="form-input"
												disabled={lockOptions}
												value={row.feeFlat}
												onChange={(ev) => {
													const v = ev.target.value;
													setNamedPlaceRows((rows) =>
														rows.map((r, i) => (i === idx ? { ...r, feeFlat: v } : r)),
													);
												}}
											/>
										</div>
										<div className="form-group" style={{ flex: "1 1 140px" }}>
											<label htmlFor={`adm-del-place-al-${row.id}`}>
												Alias (opc.)
												<AdminHelpTip text={DELIVERY_TOOLTIPS.namedZoneAliases} />
											</label>
											<input
												id={`adm-del-place-al-${row.id}`}
												type="text"
												className="form-input"
												placeholder="Separados por coma"
												disabled={lockOptions}
												value={row.aliasesStr ?? ""}
												onChange={(ev) => {
													const v = ev.target.value;
													setNamedPlaceRows((rows) =>
														rows.map((r, i) => (i === idx ? { ...r, aliasesStr: v } : r)),
													);
												}}
											/>
										</div>
										<button
											type="button"
											className="admin-delivery-icon-btn admin-tooltip-btn-hover"
											disabled={lockOptions}
											aria-label="Quitar zona de la lista (nombre, tarifa y alias)"
											onClick={() =>
												setNamedPlaceRows((rows) =>
													rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx),
												)
											}
										>
											<Trash2 size={16} strokeWidth={1.75} aria-hidden />
											<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
												{DELIVERY_TOOLTIPS.removeNamedZoneRow}
											</span>
										</button>
									</div>
								))}
								<button
									type="button"
									className="btn btn-secondary admin-tooltip-btn-hover"
									style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
									disabled={lockOptions}
									onClick={() =>
										setNamedPlaceRows((rows) => [
											...rows,
											{ id: `p${Date.now()}`, name: "", feeFlat: "", aliasesStr: "" },
										])
									}
								>
									<Plus size={16} strokeWidth={1.75} aria-hidden /> Añadir zona
									<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
										{DELIVERY_TOOLTIPS.addNamedZone}
									</span>
								</button>
							</div>
						</>
					) : (
						<div className="admin-delivery-strategy-block" style={{ marginTop: 14 }}>
							<p className="admin-menu-options-card-desc admin-delivery-inline-tip" style={{ marginBottom: 12 }}>
								<strong>Uber Direct:</strong> el <strong>Client ID y Secret</strong> de la app Uber están en
								la base de datos por <strong>empresa</strong> (los configura soporte/GodCode en admin
								SaaS). Aquí solo defines el <strong>Store ID</strong> de esta sucursal y si el cliente ve
								el monto cotizado o solo un mensaje.
							</p>
							<div className="form-group" style={{ maxWidth: "36rem" }}>
								<label htmlFor="adm-del-uber-store-id">
									Store ID (Uber Direct) — esta sucursal
									<AdminHelpTip text={DELIVERY_TOOLTIPS.uberStoreId} />
								</label>
								<input
									id="adm-del-uber-store-id"
									type="text"
									className="form-input"
									style={{ fontFamily: "ui-monospace, monospace" }}
									placeholder="UUID o id del local en Uber"
									disabled={lockOptions}
									autoComplete="off"
									value={draft.uberDirectStoreId}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, uberDirectStoreId: ev.target.value }))
									}
								/>
							</div>
							<div
								className="admin-delivery-pay-chip-row"
								style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}
							>
								<button
									type="button"
									role="checkbox"
									aria-checked={showExternalDeliveryFee}
									disabled={lockOptions}
									className={`admin-delivery-pay-chip admin-tooltip-btn-hover ${showExternalDeliveryFee ? "is-on" : ""}`}
									onClick={() => setShowExternalDeliveryFee((v) => !v)}
								>
									Mostrar monto de envío cotizado (Uber)
									<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
										{DELIVERY_TOOLTIPS.uberShowFee}
									</span>
								</button>
							</div>
							<div className="form-group" style={{ maxWidth: "36rem", marginTop: 14 }}>
								<label htmlFor="adm-del-uber-display-text">
									Texto si no se muestra monto (o mensaje complementario)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.uberDisplayText} />
								</label>
								<input
									id="adm-del-uber-display-text"
									type="text"
									className="form-input"
									placeholder="Ej. Consultar con la tienda"
									disabled={lockOptions}
									value={draft.externalDeliveryDisplayText}
									onChange={(ev) =>
										setDraft((d) => ({
											...d,
											externalDeliveryDisplayText: ev.target.value,
										}))
									}
								/>
							</div>
							<p
								className="admin-menu-options-card-desc admin-delivery-inline-tip"
								style={{ marginTop: 14, marginBottom: 0 }}
							>
								Si <strong>Mostrar monto</strong> está apagado, la API usa{" "}
								<code style={{ fontSize: "0.85em" }}>showDeliveryFeeAmount: false</code>. Con monto
								encendido, el cliente debe indicar ubicación para cotizar vía Uber.
							</p>
						</div>
					)}

						</div>
					</details>

					<details className="admin-delivery-fold">
						<summary className="admin-delivery-fold__summary">
							<div className="admin-delivery-fold__summary-text">
								<span className="admin-delivery-fold__eyebrow">Pagos</span>
								<span className="admin-delivery-fold__title">Métodos de pago (delivery)</span>
							</div>
						</summary>
						<div className="admin-delivery-fold__body">
							<p className="admin-delivery-fold__lead admin-delivery-inline-tip">
								Qué medios puede usar el cliente cuando el pedido es envío a domicilio (subconjunto de lo
								activo en <strong>Métodos de pago</strong> más efectivo y tarjeta al recibir). Si activas
								todos, no hay restricción extra.{" "}
								<AdminHelpTip text={DELIVERY_TOOLTIPS.paymentSection} />
							</p>
							<div className="admin-delivery-payment-grid">
								{deliveryPaymentKeys.map((key) => {
									const on = deliveryPaymentChecked[key] !== false;
									return (
										<button
											key={key}
											type="button"
											role="checkbox"
											aria-checked={on}
											disabled={lockOptions}
											className={`admin-delivery-pay-chip admin-tooltip-btn-hover ${on ? "is-on" : ""}`}
											onClick={() => {
												setDeliveryPaymentChecked((prev) => {
													const currOn = prev[key] !== false;
													const next = { ...prev, [key]: !currOn };
													deliveryPaymentCheckedRef.current = next;
													return next;
												});
											}}
										>
											{DELIVERY_PAYMENT_LABELS[key] ?? key}
											<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
												{DELIVERY_PAYMENT_CHIP_TITLE[key] ??
													`Permitir ${DELIVERY_PAYMENT_LABELS[key] ?? key} en pedidos delivery.`}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					</details>

					<details className="admin-delivery-fold">
						<summary className="admin-delivery-fold__summary">
							<div className="admin-delivery-fold__summary-text">
								<span className="admin-delivery-fold__eyebrow">Equipo</span>
								<span className="admin-delivery-fold__title">Repartidor y WhatsApp</span>
							</div>
						</summary>
						<div className="admin-delivery-fold__body">
							<p className="admin-delivery-fold__lead admin-delivery-inline-tip">
								En el tablero, el botón de WhatsApp abre el mensaje del envío y eliges al destinatario en la
								app. <AdminHelpTip text={DELIVERY_TOOLTIPS.driverWhatsApp} />
							</p>
							<div className="form-group" style={{ maxWidth: "22rem" }}>
								<label htmlFor="adm-del-driver-wa">
									WhatsApp repartidor (opcional)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.driverWhatsApp} />
								</label>
								<input
									id="adm-del-driver-wa"
									type="tel"
									className="form-input"
									placeholder="Ej: 56 9 1234 5678"
									autoComplete="off"
									disabled={lockOptions}
									value={draft.trustedDriverWhatsApp}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, trustedDriverWhatsApp: ev.target.value }))
									}
								/>
								<p className="admin-menu-options-card-desc" style={{ marginTop: 6, marginBottom: 0 }}>
									Se guarda al pulsar <strong>Guardar tarifas y opciones</strong>. Déjalo vacío para quitar.
								</p>
							</div>
						</div>
					</details>

					<details
						className="admin-delivery-fold admin-delivery-fold--advanced"
						style={{ marginTop: 18 }}
					>
						<summary className="admin-delivery-fold__summary">
							<div className="admin-delivery-fold__summary-text">
								<span className="admin-delivery-fold__eyebrow">Avanzado</span>
								<span className="admin-delivery-fold__title">Límites, umbrales y texto de ayuda</span>
							</div>
						</summary>
						<div className="admin-delivery-fold__body">
							<div className="admin-branch-delivery-grid" style={{ marginTop: 0 }}>
							<div className="form-group">
								<label htmlFor="adm-del-minfee">
									Mínimo envío (opcional)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.minFee} />
								</label>
								<input
									id="adm-del-minfee"
									type="number"
									min={0}
									step="any"
									className="form-input"
									placeholder="Sin piso"
									disabled={lockOptions}
									value={draft.minFee}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, minFee: ev.target.value }))
									}
								/>
							</div>
							<div className="form-group">
								<label htmlFor="adm-del-maxfee">
									Máximo envío (opcional)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.maxFee} />
								</label>
								<input
									id="adm-del-maxfee"
									type="number"
									min={0}
									step="any"
									className="form-input"
									placeholder="Sin tope"
									disabled={lockOptions}
									value={draft.maxFee}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, maxFee: ev.target.value }))
									}
								/>
							</div>
							<div className="form-group">
								<label htmlFor="adm-del-maxkm">
									Distancia máx. (km)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.maxDeliveryKm} />
								</label>
								<input
									id="adm-del-maxkm"
									type="number"
									min={0}
									step="any"
									className="form-input"
									placeholder="Sin límite"
									disabled={lockOptions}
									value={draft.maxDeliveryKm}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, maxDeliveryKm: ev.target.value }))
									}
								/>
							</div>
							<div className="form-group">
								<label htmlFor="adm-del-free">
									Envío gratis desde (subtotal)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.freeDeliveryFromSubtotal} />
								</label>
								<input
									id="adm-del-free"
									type="number"
									min={0}
									step="any"
									className="form-input"
									placeholder="Nunca"
									disabled={lockOptions}
									value={draft.freeDeliveryFromSubtotal}
									onChange={(ev) =>
										setDraft((d) => ({
											...d,
											freeDeliveryFromSubtotal: ev.target.value,
										}))
									}
								/>
							</div>
							<div className="form-group">
								<label htmlFor="adm-del-minorder">
									Pedido mínimo (subtotal)
									<AdminHelpTip text={DELIVERY_TOOLTIPS.minOrderSubtotal} />
								</label>
								<input
									id="adm-del-minorder"
									type="number"
									min={0}
									step="any"
									className="form-input"
									placeholder="Sin mínimo"
									disabled={lockOptions}
									value={draft.minOrderSubtotal}
									onChange={(ev) =>
										setDraft((d) => ({
											...d,
											minOrderSubtotal: ev.target.value,
										}))
									}
								/>
							</div>
							<div className="form-group full-span">
								<label htmlFor="adm-del-notes">
									Mensaje para el cliente en el checkout
									<AdminHelpTip text={DELIVERY_TOOLTIPS.customerNotes} />
								</label>
								<textarea
									id="adm-del-notes"
									className="form-input"
									rows={2}
									placeholder="Ej.: Entregas en 45–60 min con caja abierta."
									disabled={lockOptions}
									value={draft.customerNotes}
									onChange={(ev) =>
										setDraft((d) => ({ ...d, customerNotes: ev.target.value }))
									}
								/>
							</div>
							{pricingStrategy === "named_areas" ? (
								<>
									<div className="form-group">
										<label htmlFor="adm-del-olat2">
											Ubicación del local · latitud (opcional)
											<AdminHelpTip text={DELIVERY_TOOLTIPS.originLatNamed} />
										</label>
										<input
											id="adm-del-olat2"
											type="text"
											inputMode="decimal"
											className="form-input"
											placeholder="Solo para sugerencias al escribir zonas"
											disabled={lockOptions}
											value={draft.originLat}
											onChange={(ev) =>
												setDraft((d) => ({ ...d, originLat: ev.target.value }))
											}
										/>
									</div>
									<div className="form-group">
										<label htmlFor="adm-del-olng2">
											Ubicación del local · longitud (opcional)
											<AdminHelpTip text={DELIVERY_TOOLTIPS.originLngNamed} />
										</label>
										<input
											id="adm-del-olng2"
											type="text"
											inputMode="decimal"
											className="form-input"
											disabled={lockOptions}
											value={draft.originLng}
											onChange={(ev) =>
												setDraft((d) => ({ ...d, originLng: ev.target.value }))
											}
										/>
									</div>
								</>
							) : null}
							</div>
						</div>
					</details>
					<p
						className="admin-menu-options-card-desc admin-delivery-inline-tip"
						style={{ marginTop: 10, marginBottom: 12 }}
					>
						<strong>Vista previa:</strong> {previewText}{" "}
						<AdminHelpTip text={DELIVERY_TOOLTIPS.preview} />
					</p>
					<button
						type="button"
						className="btn btn-primary admin-tooltip-btn-hover"
						disabled={lockOptions}
						onClick={() => void saveTariffs()}
					>
						{savingFields ? "Guardando…" : "Guardar tarifas y opciones"}
						<span className="admin-tooltip-btn-hover__panel" aria-hidden="true">
							{DELIVERY_TOOLTIPS.saveButton}
						</span>
					</button>
				</div>
			) : null}
		</section>
	);
}
