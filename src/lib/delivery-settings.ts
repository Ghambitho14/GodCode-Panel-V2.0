/**
 * Contrato JSON: `public.branches.delivery_settings` (JSONB por sucursal).
 * Claves en camelCase al guardar desde el panel.
 */

import { parseTagList } from "@/lib/inventory-taxonomy";

export const DELIVERY_MAX_PRICE_PER_KM = 500_000;
export const DELIVERY_MAX_BASE_FEE = 10_000_000;
export const DELIVERY_MAX_FEE_CAP = 50_000_000;
export const DELIVERY_MAX_KM = 500;
/** Máximo de anillos por sucursal en `delivery_settings.zones`. */
export const DELIVERY_MAX_ZONES = 12;
/** Zonas por nombre (barrio, comuna, sector) con tarifa fija — el cliente elige en checkout. */
export const DELIVERY_MAX_NAMED_AREAS = 40;
/** Alias por fila para matching con geocodificación. */
export const DELIVERY_MAX_ALIASES_PER_AREA = 8;

/** Máximo de filas por catálogo de upsell en carrito (`delivery_settings`). */
export const CART_UPSELL_MAX_ITEMS = 80;
const CART_UPSELL_MAX_PRICE = 50_000_000;
const CART_UPSELL_ID_MAX_LEN = 128;
const CART_UPSELL_NAME_MAX_LEN = 160;
const CART_UPSELL_CATEGORY_MAX_LEN = 64;
const CART_UPSELL_BEVERAGE_KIND_MAX_LEN = 64;
const CART_UPSELL_IMAGE_URL_MAX_LEN = 2048;
const CART_UPSELL_MAX_PER_ORDER = 9999;
const CART_UPSELL_MAX_UNITS_PER_SALE = 999;

const CART_UPSELL_SNAKE_KEYS = [
	"beverages_upsell_enabled_by_branch",
	"extras_enabled_by_branch",
	"beverages_catalog",
	"cart_beverages_catalog",
	"global_extras_catalog",
	"cart_global_extras_catalog",
] as const;

export type CartUpsellCatalogItem = {
	id: string;
	name: string;
	price: number;
	imageUrl: string;
	active: boolean;
	/**
	 * Subcategoría dentro del catálogo (bebidas: Aguas, Refrescos… / extras: Salsas, toppings…).
	 * Independiente de la categoría de insumos en inventario.
	 */
	category: string;
	/** UUID en `inventory_items` (misma empresa); stock por sucursal en `inventory_branch`. */
	inventoryItemId: string | null;
	/** Tope de unidades que el cliente puede pedir por línea (además del tope por stock). */
	maxPerOrder: number | null;
	/** Unidades de inventario que consume cada unidad vendida (solo aplica con `inventoryItemId`). */
	unitsPerSale: number;
	/**
	 * Tipo de bebida elegido por el local (Refresco, Agua…). Solo aplica al catálogo de bebidas; vacío en extras.
	 */
	beverageKind: string;
	/** Etiquetas de marketing / exclusividad en el ítem del carrito (p. ej. exclusivo). */
	tags: string[];
};

function parseOptionalInventoryUuid(raw: unknown): string | null {
	if (raw == null || raw === "") return null;
	const s = String(raw).trim();
	if (!s) return null;
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
	) {
		return null;
	}
	return s.toLowerCase();
}

/**
 * Une filas con el mismo `id` de distintas fuentes JSON (camel/snake/legacy).
 * Evita perder `inventoryItemId` si una clave tiene el catálogo viejo y otra el vínculo a inventario.
 */
function mergeCartUpsellCatalogById(rows: CartUpsellCatalogItem[]): CartUpsellCatalogItem[] {
	const byId = new Map<string, CartUpsellCatalogItem>();
	const order: string[] = [];
	for (const r of rows) {
		const prev = byId.get(r.id);
		if (!prev) {
			byId.set(r.id, { ...r });
			order.push(r.id);
			continue;
		}
		const inv = prev.inventoryItemId || r.inventoryItemId;
		const donorForUnits = prev.inventoryItemId ? prev : r.inventoryItemId ? r : null;
		byId.set(r.id, {
			...prev,
			name: r.name || prev.name,
			price: Number.isFinite(r.price) && r.price >= 0 ? r.price : prev.price,
			imageUrl: r.imageUrl || prev.imageUrl,
			active: r.active !== false && prev.active !== false,
			category: r.category || prev.category,
			beverageKind: r.beverageKind || prev.beverageKind,
			tags: r.tags?.length ? r.tags : prev.tags,
			maxPerOrder: r.maxPerOrder ?? prev.maxPerOrder,
			inventoryItemId: inv,
			unitsPerSale: inv
				? Math.max(
						1,
						Math.min(
							CART_UPSELL_MAX_UNITS_PER_SALE,
							donorForUnits?.inventoryItemId
								? donorForUnits.unitsPerSale || 1
								: prev.unitsPerSale || r.unitsPerSale || 1,
						),
					)
				: 1,
		});
	}
	return order.map((id) => byId.get(id)!).slice(0, CART_UPSELL_MAX_ITEMS);
}

function parseOptionalMaxPerOrder(raw: unknown): number | null {
	if (raw == null || raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 1) return null;
	return Math.min(CART_UPSELL_MAX_PER_ORDER, Math.floor(n));
}

function parseUnitsPerSale(raw: unknown): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(CART_UPSELL_MAX_UNITS_PER_SALE, Math.floor(n));
}

function parseCartUpsellCategory(raw: unknown): string {
	if (raw == null || raw === "") return "";
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return "";
	return s.slice(0, CART_UPSELL_CATEGORY_MAX_LEN);
}

function parseBeverageKind(raw: unknown): string {
	if (raw == null || raw === "") return "";
	const s = typeof raw === "string" ? raw.trim() : "";
	if (!s) return "";
	return s.slice(0, CART_UPSELL_BEVERAGE_KIND_MAX_LEN);
}

/**
 * Máximo de unidades que el cliente puede pedir de un ítem upsell en un pedido.
 * `branchStock` = `current_stock` en `inventory_branch` para el insumo vinculado y la sucursal, o `null` si no aplica.
 * Si no hay techo (sin inventario ni maxPerOrder), devuelve `null` (sin límite explícito en UI).
 */
export function cartUpsellEffectiveMaxPerOrder(
	item: Pick<CartUpsellCatalogItem, "inventoryItemId" | "maxPerOrder" | "unitsPerSale">,
	branchStock: number | null,
): number | null {
	const per = Math.max(1, item.unitsPerSale || 1);
	let fromStock: number | null = null;
	if (
		item.inventoryItemId &&
		branchStock != null &&
		Number.isFinite(branchStock) &&
		branchStock >= 0
	) {
		fromStock = Math.floor(branchStock / per);
	}
	const cap = item.maxPerOrder;
	if (fromStock == null && cap == null) return null;
	if (fromStock == null) return cap;
	if (cap == null) return fromStock;
	return Math.min(fromStock, cap);
}

function stripCartUpsellSnakeKeys(o: Record<string, unknown>): void {
	for (const k of CART_UPSELL_SNAKE_KEYS) {
		delete o[k];
	}
}

function parseBranchBooleanMap(raw: unknown): Record<string, boolean> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, boolean> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "boolean") out[k] = v;
	}
	return out;
}

/**
 * Normaliza un catálogo de ítems upsell (bebidas / extras en carrito).
 * Dedupe por `id` (gana la primera fila), precios ≥ 0 acotados.
 */
export function parseCartUpsellCatalog(raw: unknown): CartUpsellCatalogItem[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: CartUpsellCatalogItem[] = [];
	for (let i = 0; i < raw.length && out.length < CART_UPSELL_MAX_ITEMS; i++) {
		const row = raw[i];
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const o = row as Record<string, unknown>;
		const idRaw = o.id;
		const id =
			typeof idRaw === "string" && idRaw.trim()
				? idRaw.trim().slice(0, CART_UPSELL_ID_MAX_LEN)
				: "";
		if (!id || seen.has(id)) continue;
		const nameRaw = o.name ?? o.label ?? o.title;
		const name =
			typeof nameRaw === "string"
				? nameRaw.trim().slice(0, CART_UPSELL_NAME_MAX_LEN)
				: "";
		if (!name) continue;
		const priceNum = Number(o.price ?? o.fee ?? o.amount);
		if (!Number.isFinite(priceNum) || priceNum < 0) continue;
		const price = Math.min(CART_UPSELL_MAX_PRICE, priceNum);
		const imgRaw = o.imageUrl ?? o.image_url;
		const imageUrl =
			typeof imgRaw === "string"
				? imgRaw.trim().slice(0, CART_UPSELL_IMAGE_URL_MAX_LEN)
				: "";
		const active =
			o.active === false || o.is_active === false || o.enabled === false
				? false
				: true;
		const category = parseCartUpsellCategory(
			o.category ?? o.catalogCategory ?? o.group ?? o.catalog_category,
		);
		const inventoryItemId = parseOptionalInventoryUuid(
			o.inventoryItemId ?? o.inventory_item_id,
		);
		const maxPerOrder = parseOptionalMaxPerOrder(
			o.maxPerOrder ?? o.max_per_order,
		);
		let unitsPerSale = parseUnitsPerSale(o.unitsPerSale ?? o.units_per_sale);
		if (!inventoryItemId) unitsPerSale = 1;
		const beverageKind = parseBeverageKind(
			o.beverageKind ?? o.beverage_kind,
		);
		const tags = parseTagList(o.tags ?? o.catalogTags);
		seen.add(id);
		out.push({
			id,
			name,
			price,
			imageUrl,
			active,
			category,
			inventoryItemId,
			maxPerOrder,
			unitsPerSale,
			beverageKind,
			tags,
		});
	}
	return out;
}

export type CartUpsellSettingsExtracted = {
	beveragesUpsellEnabledByBranch: Record<string, boolean>;
	extrasEnabledByBranch: Record<string, boolean>;
	cartBeveragesCatalog: CartUpsellCatalogItem[];
	cartGlobalExtrasCatalog: CartUpsellCatalogItem[];
};

/**
 * Lee flags y catálogos de upsell desde JSON crudo de `delivery_settings`.
 * Unifica fallbacks camel/snake y nombres históricos de catálogo.
 */
export function extractCartUpsellSettings(raw: unknown): CartUpsellSettingsExtracted {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			beveragesUpsellEnabledByBranch: {},
			extrasEnabledByBranch: {},
			cartBeveragesCatalog: [],
			cartGlobalExtrasCatalog: [],
		};
	}
	const o = raw as Record<string, unknown>;
	const beveragesUpsellEnabledByBranch = parseBranchBooleanMap(
		o.beveragesUpsellEnabledByBranch ?? o.beverages_upsell_enabled_by_branch,
	);
	const extrasEnabledByBranch = parseBranchBooleanMap(
		o.extrasEnabledByBranch ?? o.extras_enabled_by_branch,
	);
	const beverageSources = [
		o.cartBeveragesCatalog,
		o.cart_beverages_catalog,
		o.beveragesCatalog,
		o.beverages_catalog,
	].filter((x): x is unknown[] => Array.isArray(x) && x.length > 0);
	const cartBeveragesCatalog = mergeCartUpsellCatalogById(
		beverageSources.flatMap((src) => parseCartUpsellCatalog(src)),
	);
	const extraSources = [
		o.cartGlobalExtrasCatalog,
		o.cart_global_extras_catalog,
		o.globalExtrasCatalog,
		o.global_extras_catalog,
	].filter((x): x is unknown[] => Array.isArray(x) && x.length > 0);
	const cartGlobalExtrasCatalog = mergeCartUpsellCatalogById(
		extraSources.flatMap((src) => parseCartUpsellCatalog(src)),
	);
	return {
		beveragesUpsellEnabledByBranch,
		extrasEnabledByBranch,
		cartBeveragesCatalog,
		cartGlobalExtrasCatalog,
	};
}

/** Claves permitidas para restringir pagos solo en delivery (coincide con `payment_methods` + presencial). */
export const DELIVERY_PAYMENT_METHOD_IDS = new Set([
	"tienda",
	"tarjeta",
	"paypal",
	"stripe",
	"pago_movil",
	"zelle",
	"transferencia_bancaria",
]);

/** Cómo cotiza la sucursal: km, zonas con nombre, o externo (sin cotización en checkout). */
export type DeliveryPricingStrategy = "distance" | "named_areas" | "external";

/** Proveedor cuando `deliveryPricingStrategy === "external"` (p. ej. Uber Direct). */
export type ExternalDeliveryProvider = "uber_direct";

/** Si `named_areas`: lista manual o inferencia desde dirección (servidor). */
export type NamedAreaResolution = "manual_select" | "address_matched";

/** Anillo por distancia desde el local: si el envío cae dentro del radio, tarifa fija. */
export type DeliveryZoneNormalized = {
	id: string;
	radiusKm: number;
	feeFlat: number;
};

export type DeliveryNamedArea = {
	id: string;
	name: string;
	feeFlat: number;
	/** Nombres alternativos para matching con dirección (geocoding). */
	aliases?: string[];
};

export type DeliverySettingsNormalized = {
	enabled: boolean;
	/**
	 * Subconjunto de métodos permitidos solo para pedidos delivery.
	 * `null`: sin restricción extra (todos los habilitados en la sucursal + efectivo/tarjeta al recibir).
	 */
	allowedPaymentMethodsForDelivery: string[] | null;
	/**
	 * `named_areas`: usa `namedAreas` + `namedAreaResolution`.
	 * `distance`: usa km desde el local (`zones`, `pricePerKm`, `baseFee`).
	 * `external`: cotización vía proveedor (p. ej. Uber Direct) o solo texto sin monto.
	 */
	deliveryPricingStrategy: DeliveryPricingStrategy;
	/** Solo con estrategia `external`; por defecto `uber_direct`. */
	externalDeliveryProvider: ExternalDeliveryProvider | null;
	/** Store ID de Uber Direct para esta sucursal (pickup). */
	uberDirectStoreId: string | null;
	/** Si es false, el menú público muestra texto sin monto de envío. */
	showExternalDeliveryFeeAmount: boolean;
	/** Texto cuando no se muestra monto de envío. */
	externalDeliveryDisplayText: string;
	namedAreaResolution: NamedAreaResolution;
	pricePerKm: number;
	baseFee: number;
	minFee: number | null;
	maxFee: number | null;
	maxDeliveryKm: number | null;
	freeDeliveryFromSubtotal: number | null;
	minOrderSubtotal: number | null;
	customerNotes: string;
	zones: DeliveryZoneNormalized[];
	namedAreas: DeliveryNamedArea[];
};

export type DeliverySettingsPublic = DeliverySettingsNormalized;

const DEFAULTS: DeliverySettingsNormalized = {
	enabled: true,
	allowedPaymentMethodsForDelivery: null,
	deliveryPricingStrategy: "distance",
	externalDeliveryProvider: null,
	uberDirectStoreId: null,
	showExternalDeliveryFeeAmount: true,
	externalDeliveryDisplayText: "Consultar con la tienda",
	namedAreaResolution: "manual_select",
	pricePerKm: 0,
	baseFee: 0,
	minFee: null,
	maxFee: null,
	maxDeliveryKm: null,
	freeDeliveryFromSubtotal: null,
	minOrderSubtotal: null,
	customerNotes: "",
	zones: [],
	namedAreas: [],
};

function clampNonNeg(n: number, max: number): number {
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(max, n);
}

function parseOptionalCap(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.min(DELIVERY_MAX_FEE_CAP, n);
}

function parseBool(raw: unknown, defaultVal: boolean): boolean {
	if (typeof raw === "boolean") return raw;
	return defaultVal;
}

function parseNotes(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw.trim().slice(0, 2000);
}

function parseZones(raw: unknown): DeliveryZoneNormalized[] {
	if (!Array.isArray(raw)) return [];
	const out: DeliveryZoneNormalized[] = [];
	for (let i = 0; i < raw.length && out.length < DELIVERY_MAX_ZONES; i++) {
		const row = raw[i];
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const o = row as Record<string, unknown>;
		const radius = Number(o.radiusKm ?? o.radius_km ?? o.radius);
		const fee = Number(o.feeFlat ?? o.fee_flat ?? o.fee);
		if (!Number.isFinite(radius) || radius <= 0 || radius > DELIVERY_MAX_KM) continue;
		if (!Number.isFinite(fee) || fee < 0) continue;
		const idRaw = o.id;
		const id =
			typeof idRaw === "string" && idRaw.trim()
				? idRaw.trim().slice(0, 64)
				: `z${out.length}`;
		out.push({
			id,
			radiusKm: Math.min(DELIVERY_MAX_KM, radius),
			feeFlat: Math.min(DELIVERY_MAX_FEE_CAP, fee),
		});
	}
	out.sort((a, b) => a.radiusKm - b.radiusKm);
	return out;
}

function parseNamedAreas(raw: unknown): DeliveryNamedArea[] {
	if (!Array.isArray(raw)) return [];
	const out: DeliveryNamedArea[] = [];
	for (let i = 0; i < raw.length && out.length < DELIVERY_MAX_NAMED_AREAS; i++) {
		const row = raw[i];
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const o = row as Record<string, unknown>;
		const nameRaw = o.name ?? o.label ?? o.place ?? o.title;
		const name =
			typeof nameRaw === "string"
				? nameRaw.trim().slice(0, 120)
				: "";
		if (!name) continue;
		const fee = Number(o.feeFlat ?? o.fee_flat ?? o.fee ?? o.price);
		if (!Number.isFinite(fee) || fee < 0) continue;
		const idRaw = o.id;
		const id =
			typeof idRaw === "string" && idRaw.trim()
				? idRaw.trim().slice(0, 64)
				: `place_${out.length}_${name.slice(0, 20).replace(/\s+/g, "_")}`;
		const aliasesRaw = o.aliases;
		let aliases: string[] | undefined;
		if (Array.isArray(aliasesRaw)) {
			const al = aliasesRaw
				.filter((x): x is string => typeof x === "string")
				.map((x) => x.trim().slice(0, 80))
				.filter(Boolean)
				.slice(0, DELIVERY_MAX_ALIASES_PER_AREA);
			if (al.length > 0) aliases = al;
		}
		const area: DeliveryNamedArea = {
			id,
			name,
			feeFlat: Math.min(DELIVERY_MAX_FEE_CAP, fee),
		};
		if (aliases) area.aliases = aliases;
		out.push(area);
	}
	return out;
}

function parseDeliveryPricingStrategy(
	raw: unknown,
	namedAreasCount: number,
): DeliveryPricingStrategy {
	const v =
		typeof raw === "string"
			? raw.trim().toLowerCase().replace(/-/g, "_")
			: "";
	if (
		v === "external" ||
		v === "store_consult" ||
		v === "uber_direct" ||
		v === "uber" ||
		v === "provider"
	) {
		return "external";
	}
	if (v === "named_areas" || v === "namedareas") return "named_areas";
	if (v === "distance" || v === "km") return "distance";
	// Migración: JSON antiguo sin clave pero con zonas por nombre
	if (namedAreasCount > 0) return "named_areas";
	return "distance";
}

function parseNamedAreaResolution(raw: unknown): NamedAreaResolution {
	const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (v === "address_matched" || v === "address" || v === "auto") {
		return "address_matched";
	}
	return "manual_select";
}

function parseExternalDeliveryProvider(raw: unknown): ExternalDeliveryProvider | null {
	const v =
		typeof raw === "string"
			? raw.trim().toLowerCase().replace(/-/g, "_")
			: "";
	if (v === "uber_direct" || v === "uber") return "uber_direct";
	return null;
}

function parseUberDirectStoreId(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const t = raw.trim();
	return t.length > 0 ? t.slice(0, 128) : null;
}

function parseShowExternalDeliveryFeeAmount(
	raw: unknown,
	defaultVal: boolean,
): boolean {
	if (typeof raw === "boolean") return raw;
	if (raw === "false" || raw === 0) return false;
	if (raw === "true" || raw === 1) return true;
	return defaultVal;
}

function parseAllowedPaymentMethodsForDelivery(raw: unknown): string[] | null {
	if (raw === null || raw === undefined) return null;
	if (!Array.isArray(raw)) return null;
	const out: string[] = [];
	for (const x of raw) {
		if (typeof x !== "string") continue;
		const k = x.trim().toLowerCase();
		if (!DELIVERY_PAYMENT_METHOD_IDS.has(k)) continue;
		if (!out.includes(k)) out.push(k);
		if (out.length >= 24) break;
	}
	return out.length > 0 ? out : null;
}

/** Claves por defecto para delivery: efectivo/tarjeta al recibir + métodos digitales de la sucursal. */
export function buildDefaultDeliveryPaymentKeys(
	branchPaymentMethods: string[] | null | undefined,
): string[] {
	const base = Array.isArray(branchPaymentMethods)
		? branchPaymentMethods
				.map((k) => String(k).trim().toLowerCase())
				.filter((k) => DELIVERY_PAYMENT_METHOD_IDS.has(k))
		: [];
	return [...new Set(["tienda", "tarjeta", ...base])];
}

/**
 * Métodos efectivos que el checkout puede ofrecer en delivery (intersección restricción × sucursal).
 */
export function resolveDeliveryPaymentMethodsForCheckout(
	branchPaymentMethods: string[] | null | undefined,
	settings: DeliverySettingsNormalized,
): string[] {
	const defaults = buildDefaultDeliveryPaymentKeys(branchPaymentMethods);
	const restriction = settings.allowedPaymentMethodsForDelivery;
	if (!restriction || restriction.length === 0) {
		return defaults;
	}
	const allowed = new Set(restriction);
	return defaults.filter((k) => allowed.has(k));
}

const ONLINE_RAILS = new Set([
	"paypal",
	"stripe",
	"pago_movil",
	"zelle",
	"transferencia_bancaria",
]);

/** Clave estable para comparar con `allowedPaymentMethodsForDelivery`. */
export function orderPaymentKeyForDelivery(order: {
	payment_type?: unknown;
	payment_method_specific?: unknown;
}): string {
	const t = String(order.payment_type ?? "").trim().toLowerCase();
	if (t === "tienda") return "tienda";
	if (t === "tarjeta" || t === "card") return "tarjeta";
	if (t === "online" || t === "transferencia") {
		const spec = String(order.payment_method_specific ?? "").trim().toLowerCase();
		if (spec && ONLINE_RAILS.has(spec)) return spec;
		return "online";
	}
	return t;
}

export function isOrderPaymentAllowedForDelivery(
	order: { payment_type?: unknown; payment_method_specific?: unknown },
	branchPaymentMethods: string[] | null | undefined,
	settings: DeliverySettingsNormalized,
): boolean {
	const effective = resolveDeliveryPaymentMethodsForCheckout(
		branchPaymentMethods,
		settings,
	);
	if (effective.length === 0) return false;
	const key = orderPaymentKeyForDelivery(order);
	if (key === "online") {
		const spec = String(order.payment_method_specific ?? "").trim().toLowerCase();
		if (spec && ONLINE_RAILS.has(spec)) {
			return effective.includes(spec);
		}
		const rails = (branchPaymentMethods ?? [])
			.map((x) => String(x).trim().toLowerCase())
			.filter((r) => ONLINE_RAILS.has(r));
		return rails.some((r) => effective.includes(r));
	}
	return effective.includes(key);
}

/** Normaliza lectura desde JSONB (camelCase; tolera algunos snake_case). */
export function normalizeDeliverySettings(raw: unknown): DeliverySettingsNormalized {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ...DEFAULTS };
	}
	const o = raw as Record<string, unknown>;
	const price =
		o.pricePerKm ??
		o.price_per_km ??
		o.priceperkm;
	const base = o.baseFee ?? o.base_fee;
	const minF = o.minFee ?? o.min_fee;
	const maxF = o.maxFee ?? o.max_fee;
	const maxKm = o.maxDeliveryKm ?? o.max_delivery_km;
	const freeFrom = o.freeDeliveryFromSubtotal ?? o.free_delivery_from_subtotal;
	const minOrder = o.minOrderSubtotal ?? o.min_order_subtotal;
	const notes = o.customerNotes ?? o.customer_notes ?? o.notes;
	const zonesRaw = o.zones ?? o.delivery_zones;
	const namedRaw =
		o.namedAreas ?? o.named_areas ?? o.delivery_places ?? o.places;
	const namedParsed = parseNamedAreas(namedRaw);
	const stratRaw =
		o.deliveryPricingStrategy ??
		o.delivery_pricing_strategy ??
		o.pricingStrategy ??
		o.pricing_mode;
	const narRaw =
		o.namedAreaResolution ?? o.named_area_resolution ?? o.namedAreaMatch;
	const extProvRaw =
		o.externalDeliveryProvider ??
		o.external_delivery_provider ??
		o.deliveryProvider ??
		o.delivery_provider;
	const uberStoreRaw =
		o.uberDirectStoreId ?? o.uber_direct_store_id ?? o.uberStoreId ?? o.uber_store_id;
	const showExtFeeRaw =
		o.showExternalDeliveryFeeAmount ??
		o.show_external_delivery_fee_amount ??
		o.showDeliveryFeeAmount ??
		o.show_delivery_fee_amount;
	const extDisplayRaw =
		o.externalDeliveryDisplayText ??
		o.external_delivery_display_text ??
		o.deliveryDisplayText ??
		o.delivery_display_text;
	const allowedPayRaw =
		o.allowedPaymentMethodsForDelivery ?? o.allowed_payment_methods_for_delivery;

	let deliveryPricingStrategy = parseDeliveryPricingStrategy(
		stratRaw,
		namedParsed.length,
	);
	let externalDeliveryProvider = parseExternalDeliveryProvider(extProvRaw);
	let uberDirectStoreId = parseUberDirectStoreId(uberStoreRaw);
	if (
		deliveryPricingStrategy === "external" &&
		externalDeliveryProvider == null
	) {
		externalDeliveryProvider = "uber_direct";
	}
	if (deliveryPricingStrategy !== "external") {
		externalDeliveryProvider = null;
		uberDirectStoreId = null;
	}

	return {
		enabled: parseBool(o.enabled, DEFAULTS.enabled),
		allowedPaymentMethodsForDelivery: parseAllowedPaymentMethodsForDelivery(allowedPayRaw),
		deliveryPricingStrategy,
		externalDeliveryProvider,
		uberDirectStoreId,
		showExternalDeliveryFeeAmount: parseShowExternalDeliveryFeeAmount(
			showExtFeeRaw,
			DEFAULTS.showExternalDeliveryFeeAmount,
		),
		externalDeliveryDisplayText: (() => {
			if (typeof extDisplayRaw === "string" && extDisplayRaw.trim()) {
				return extDisplayRaw.trim().slice(0, 500);
			}
			return DEFAULTS.externalDeliveryDisplayText;
		})(),
		namedAreaResolution: parseNamedAreaResolution(narRaw),
		pricePerKm: clampNonNeg(Number(price) || 0, DELIVERY_MAX_PRICE_PER_KM),
		baseFee: clampNonNeg(Number(base) || 0, DELIVERY_MAX_BASE_FEE),
		minFee: parseOptionalCap(minF),
		maxFee: parseOptionalCap(maxF),
		zones: parseZones(zonesRaw),
		namedAreas: namedParsed,
		maxDeliveryKm: (() => {
			const v = maxKm;
			if (v === null || v === undefined || v === "") return null;
			const n = Number(v);
			if (!Number.isFinite(n) || n <= 0) return null;
			return Math.min(DELIVERY_MAX_KM, n);
		})(),
		freeDeliveryFromSubtotal: (() => {
			const v = freeFrom;
			if (v === null || v === undefined || v === "") return null;
			const n = Number(v);
			if (!Number.isFinite(n) || n < 0) return null;
			return Math.min(DELIVERY_MAX_FEE_CAP, n);
		})(),
		minOrderSubtotal: (() => {
			const v = minOrder;
			if (v === null || v === undefined || v === "") return null;
			const n = Number(v);
			if (!Number.isFinite(n) || n < 0) return null;
			return Math.min(DELIVERY_MAX_FEE_CAP, n);
		})(),
		customerNotes: parseNotes(notes),
	};
}

export function deliverySettingsToPublic(
	s: DeliverySettingsNormalized,
): DeliverySettingsPublic {
	return { ...s };
}

/**
 * Texto que debe mostrarse en el checkout en lugar de un monto de envío (Uber Direct, etc.).
 * Si hay notas propias en la sucursal, sustituyen al texto por defecto.
 */
export const EXTERNAL_DELIVERY_DEFAULT_DISPLAY = "Consultar con la tienda";

export function externalDeliveryCheckoutHint(
	settings: DeliverySettingsNormalized,
): string {
	const display = settings.externalDeliveryDisplayText?.trim();
	if (display) return display;
	const n = settings.customerNotes?.trim();
	if (n) return n;
	return EXTERNAL_DELIVERY_DEFAULT_DISPLAY;
}

/** Merge parcial guardando solo claves conocidas; preserva el resto del JSON previo. */
export function mergeDeliverySettingsJson(
	prev: unknown,
	patch: Partial<Record<string, unknown>>,
): Record<string, unknown> {
	const base =
		prev && typeof prev === "object" && !Array.isArray(prev)
			? { ...(prev as Record<string, unknown>) }
			: {};
	const next = { ...base };

	const assignNum = (
		key: string,
		_val: unknown,
		clampMax: number,
		allowNull = false,
	) => {
		if (!(key in patch)) return;
		const v = patch[key];
		if (allowNull && (v === null || v === "")) {
			next[key] = null;
			return;
		}
		const n = Number(v);
		if (!Number.isFinite(n)) return;
		next[key] = Math.min(clampMax, Math.max(0, n));
	};

	if ("enabled" in patch && typeof patch.enabled === "boolean") {
		next.enabled = patch.enabled;
	}
	assignNum("pricePerKm", patch.pricePerKm, DELIVERY_MAX_PRICE_PER_KM);
	assignNum("baseFee", patch.baseFee, DELIVERY_MAX_BASE_FEE);
	if ("minFee" in patch) {
		const v = patch.minFee;
		if (v === null || v === "") next.minFee = null;
		else assignNum("minFee", v, DELIVERY_MAX_FEE_CAP);
	}
	if ("maxFee" in patch) {
		const v = patch.maxFee;
		if (v === null || v === "") next.maxFee = null;
		else assignNum("maxFee", v, DELIVERY_MAX_FEE_CAP);
	}
	if ("maxDeliveryKm" in patch) {
		const v = patch.maxDeliveryKm;
		if (v === null || v === "") next.maxDeliveryKm = null;
		else {
			const n = Number(v);
			if (Number.isFinite(n) && n > 0) {
				next.maxDeliveryKm = Math.min(DELIVERY_MAX_KM, n);
			}
		}
	}
	if ("freeDeliveryFromSubtotal" in patch) {
		const v = patch.freeDeliveryFromSubtotal;
		if (v === null || v === "") next.freeDeliveryFromSubtotal = null;
		else assignNum("freeDeliveryFromSubtotal", v, DELIVERY_MAX_FEE_CAP);
	}
	if ("minOrderSubtotal" in patch) {
		const v = patch.minOrderSubtotal;
		if (v === null || v === "") next.minOrderSubtotal = null;
		else assignNum("minOrderSubtotal", v, DELIVERY_MAX_FEE_CAP);
	}
	if ("customerNotes" in patch && typeof patch.customerNotes === "string") {
		next.customerNotes = parseNotes(patch.customerNotes);
	}
	if ("zones" in patch) {
		next.zones = parseZones(patch.zones);
	}
	if ("namedAreas" in patch) {
		next.namedAreas = parseNamedAreas(patch.namedAreas);
	}
	if ("deliveryPricingStrategy" in patch) {
		const v = patch.deliveryPricingStrategy;
		if (v === "named_areas" || v === "distance" || v === "external") {
			next.deliveryPricingStrategy = v;
		}
	}
	if ("namedAreaResolution" in patch) {
		const v = patch.namedAreaResolution;
		if (v === "manual_select" || v === "address_matched") {
			next.namedAreaResolution = v;
		}
	}
	if ("externalDeliveryProvider" in patch) {
		const v = patch.externalDeliveryProvider;
		if (v === "uber_direct" || v === null) {
			next.externalDeliveryProvider = v;
		}
	}
	if ("uberDirectStoreId" in patch) {
		const v = patch.uberDirectStoreId;
		if (v === null) next.uberDirectStoreId = null;
		else if (typeof v === "string") next.uberDirectStoreId = v.trim().slice(0, 128);
	}
	if ("showExternalDeliveryFeeAmount" in patch) {
		const v = patch.showExternalDeliveryFeeAmount;
		if (typeof v === "boolean") next.showExternalDeliveryFeeAmount = v;
	}
	if ("externalDeliveryDisplayText" in patch) {
		const v = patch.externalDeliveryDisplayText;
		if (v === null || v === "") {
			next.externalDeliveryDisplayText = DEFAULTS.externalDeliveryDisplayText;
		} else if (typeof v === "string") {
			next.externalDeliveryDisplayText = parseNotes(v).slice(0, 500);
		}
	}
	if ("allowedPaymentMethodsForDelivery" in patch) {
		const v = patch.allowedPaymentMethodsForDelivery;
		if (v === null || v === "") {
			delete next.allowedPaymentMethodsForDelivery;
			delete next.allowed_payment_methods_for_delivery;
		} else if (Array.isArray(v)) {
			const parsed = parseAllowedPaymentMethodsForDelivery(v);
			if (parsed && parsed.length > 0) {
				next.allowedPaymentMethodsForDelivery = parsed;
				delete next.allowed_payment_methods_for_delivery;
			} else {
				delete next.allowedPaymentMethodsForDelivery;
				delete next.allowed_payment_methods_for_delivery;
			}
		}
	}

	/** Solo panel staff; no forma parte del contrato público de cotización. */
	if ("trustedDriverWhatsApp" in patch) {
		const v = patch.trustedDriverWhatsApp;
		if (v === null || v === "") {
			delete next.trustedDriverWhatsApp;
			delete next.trusted_driver_whatsapp;
		} else if (typeof v === "string") {
			const digits = v.replace(/\D/g, "").slice(0, 18);
			if (digits.length >= 8) {
				next.trustedDriverWhatsApp = digits;
			}
			delete next.trusted_driver_whatsapp;
		}
	}

	if ("beveragesUpsellEnabledByBranch" in patch) {
		const v = patch.beveragesUpsellEnabledByBranch;
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const prev = parseBranchBooleanMap(next.beveragesUpsellEnabledByBranch);
			const add = parseBranchBooleanMap(v);
			next.beveragesUpsellEnabledByBranch = { ...prev, ...add };
			stripCartUpsellSnakeKeys(next);
		}
	}
	if ("extrasEnabledByBranch" in patch) {
		const v = patch.extrasEnabledByBranch;
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const prev = parseBranchBooleanMap(next.extrasEnabledByBranch);
			const add = parseBranchBooleanMap(v);
			next.extrasEnabledByBranch = { ...prev, ...add };
			stripCartUpsellSnakeKeys(next);
		}
	}
	if ("cartBeveragesCatalog" in patch) {
		next.cartBeveragesCatalog = parseCartUpsellCatalog(patch.cartBeveragesCatalog);
		delete next.beveragesCatalog;
		delete next.beverages_catalog;
		stripCartUpsellSnakeKeys(next);
	}
	if ("cartGlobalExtrasCatalog" in patch) {
		next.cartGlobalExtrasCatalog = parseCartUpsellCatalog(patch.cartGlobalExtrasCatalog);
		delete next.globalExtrasCatalog;
		delete next.global_extras_catalog;
		stripCartUpsellSnakeKeys(next);
	}

	if (
		typeof next.minFee === "number" &&
		typeof next.maxFee === "number" &&
		next.minFee > next.maxFee
	) {
		const t = next.minFee;
		next.minFee = next.maxFee;
		next.maxFee = t;
	}

	return next;
}

/** Modo efectivo para UI y APIs: `named` solo si estrategia + lista no vacía; `external` con Uber Direct. */
export function effectiveDeliveryPricingMode(
	s: DeliverySettingsNormalized,
): "named" | "distance" | "external" {
	if (
		s.deliveryPricingStrategy === "external" &&
		s.externalDeliveryProvider === "uber_direct"
	) {
		return "external";
	}
	if (
		s.deliveryPricingStrategy === "named_areas" &&
		s.namedAreas.length > 0
	) {
		return "named";
	}
	return "distance";
}

export type ComputeDeliveryFeeOptions = {
	/** Si la sucursal tiene `namedAreas`, debe coincidir con un id configurado. */
	namedAreaId?: string | null;
};

/**
 * Códigos de error en `fee`: -1 distancia máxima, -2 pedido mínimo, -3 falta zona por nombre, -4 zona inválida.
 */
export function computeDeliveryFee(
	settings: DeliverySettingsNormalized,
	deliveryKm: number,
	itemsSubtotal: number,
	options?: ComputeDeliveryFeeOptions,
): { fee: number; waivedFreeShipping: boolean } {
	if (!settings.enabled) {
		return { fee: 0, waivedFreeShipping: false };
	}

	if (effectiveDeliveryPricingMode(settings) === "external") {
		return { fee: 0, waivedFreeShipping: false };
	}

	const namedId =
		options?.namedAreaId != null && String(options.namedAreaId).trim() !== ""
			? String(options.namedAreaId).trim()
			: null;
	const areas = settings.namedAreas;
	const useNamed =
		effectiveDeliveryPricingMode(settings) === "named" && areas.length > 0;

	if (useNamed) {
		if (!namedId) {
			return { fee: -3, waivedFreeShipping: false };
		}
		const area = areas.find((a) => a.id === namedId);
		if (!area) {
			return { fee: -4, waivedFreeShipping: false };
		}
		if (
			settings.minOrderSubtotal != null &&
			itemsSubtotal + 1e-9 < settings.minOrderSubtotal
		) {
			return { fee: -2, waivedFreeShipping: false };
		}
		if (
			settings.freeDeliveryFromSubtotal != null &&
			itemsSubtotal + 1e-9 >= settings.freeDeliveryFromSubtotal
		) {
			return { fee: 0, waivedFreeShipping: true };
		}
		let fee = area.feeFlat;
		if (settings.minFee != null) fee = Math.max(fee, settings.minFee);
		if (settings.maxFee != null) fee = Math.min(fee, settings.maxFee);
		if (!Number.isFinite(fee) || fee < 0) fee = 0;
		return { fee: Math.round(fee * 100) / 100, waivedFreeShipping: false };
	}

	const km = Number(deliveryKm);
	const safeKm = Number.isFinite(km) && km >= 0 ? km : 0;
	if (
		settings.maxDeliveryKm != null &&
		safeKm > settings.maxDeliveryKm + 1e-9
	) {
		return { fee: -1, waivedFreeShipping: false };
	}
	if (
		settings.minOrderSubtotal != null &&
		itemsSubtotal + 1e-9 < settings.minOrderSubtotal
	) {
		return { fee: -2, waivedFreeShipping: false };
	}
	if (
		settings.freeDeliveryFromSubtotal != null &&
		itemsSubtotal + 1e-9 >= settings.freeDeliveryFromSubtotal
	) {
		return { fee: 0, waivedFreeShipping: true };
	}
	let fee: number;
	const zones = settings.zones;
	if (zones && zones.length > 0) {
		let flat: number | null = null;
		for (const z of zones) {
			if (safeKm <= z.radiusKm + 1e-9) {
				flat = z.feeFlat;
				break;
			}
		}
		fee =
			flat != null
				? flat
				: settings.baseFee + safeKm * settings.pricePerKm;
	} else {
		fee = settings.baseFee + safeKm * settings.pricePerKm;
	}
	if (settings.minFee != null) fee = Math.max(fee, settings.minFee);
	if (settings.maxFee != null) fee = Math.min(fee, settings.maxFee);
	if (!Number.isFinite(fee) || fee < 0) fee = 0;
	return { fee: Math.round(fee * 100) / 100, waivedFreeShipping: false };
}

/** Suma ítems del pedido (precio efectivo × cantidad). */
export function orderItemsSubtotalFromPayload(
	items: Array<{ price?: unknown; quantity?: unknown }>,
): number {
	if (!Array.isArray(items)) return 0;
	let sum = 0;
	for (const it of items) {
		const p = Number(it.price) || 0;
		const q = Math.max(1, Number(it.quantity) || 1);
		sum += p * q;
	}
	return Math.round(sum * 100) / 100;
}
