import { supabase, TABLES } from '@/integrations/supabase';
import {
	extractCartUpsellSettings,
	mergeDeliverySettingsJson,
	normalizeDeliverySettings,
} from '@/lib/delivery-settings';
import { isTenantExternalDeliveryAllowed } from '@/lib/company-integration-policy';

/**
 * Servicio de configuración por sucursal (delivery + payment methods + cart upsell).
 *
 * Reemplaza al endpoint Next.js legacy `/api/tenant-branch-delivery-enabled` que en
 * `proyecto viejo` consultaba/escribia `branches.delivery_settings` (JSONB),
 * `branches.origin_lat/lng` y `companies.integration_settings` con `supabaseAdmin`.
 *
 * En GodCode-panel el front llama directo a Supabase con el JWT del usuario logueado;
 * la autorizacion la aplica RLS sobre `branches` y `companies` (filtran por tenant).
 *
 * El JSONB `delivery_settings` puede contener entre otras claves:
 *  - enabled, pricing_mode, fixed_fee, namedAreas, namedAreaResolution
 *  - cartBeveragesCatalog, cartGlobalExtrasCatalog
 *  - beveragesUpsellEnabledByBranch, extrasEnabledByBranch
 */

/**
 * Replica `pickTrustedDriverWhatsAppDigits` del endpoint legacy.
 * @param {unknown} raw
 * @returns {string}
 */
function pickTrustedDriverWhatsAppDigits(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
	const v = raw.trustedDriverWhatsApp ?? raw.trusted_driver_whatsapp;
	if (typeof v !== 'string') return '';
	return v.replace(/\D/g, '').slice(0, 18);
}

/**
 * Construye el shape EXACTO que devolvia el GET de
 * `/api/tenant-branch-delivery-enabled`.
 *
 * @param {unknown} deliverySettingsRaw
 * @param {{ lat: number|null, lng: number|null }} [origin]
 * @returns {object}
 */
function settingsResponse(deliverySettingsRaw, origin) {
	const n = normalizeDeliverySettings(deliverySettingsRaw);
	const trustedWa = pickTrustedDriverWhatsAppDigits(deliverySettingsRaw);
	const cart = extractCartUpsellSettings(deliverySettingsRaw);
	return {
		enabled: n.enabled,
		deliveryPricingStrategy: n.deliveryPricingStrategy,
		externalDeliveryProvider: n.externalDeliveryProvider,
		uberDirectStoreId: n.uberDirectStoreId,
		showExternalDeliveryFeeAmount: n.showExternalDeliveryFeeAmount,
		externalDeliveryDisplayText: n.externalDeliveryDisplayText,
		namedAreaResolution: n.namedAreaResolution,
		pricePerKm: n.pricePerKm,
		baseFee: n.baseFee,
		minFee: n.minFee,
		maxFee: n.maxFee,
		maxDeliveryKm: n.maxDeliveryKm,
		freeDeliveryFromSubtotal: n.freeDeliveryFromSubtotal,
		minOrderSubtotal: n.minOrderSubtotal,
		customerNotes: n.customerNotes,
		zones: n.zones,
		namedAreas: n.namedAreas,
		allowedPaymentMethodsForDelivery: n.allowedPaymentMethodsForDelivery,
		originLat: origin?.lat ?? null,
		originLng: origin?.lng ?? null,
		trustedDriverWhatsApp: trustedWa.length >= 8 ? trustedWa : '',
		beveragesUpsellEnabledByBranch: cart.beveragesUpsellEnabledByBranch,
		extrasEnabledByBranch: cart.extrasEnabledByBranch,
		cartBeveragesCatalog: cart.cartBeveragesCatalog,
		cartGlobalExtrasCatalog: cart.cartGlobalExtrasCatalog,
	};
}

/** Whitelist de keys validas para PATCH. Replica `buildPatchFromBody` del endpoint legacy. */
const PATCH_PASSTHROUGH_KEYS = [
	'enabled',
	'deliveryPricingStrategy',
	'externalDeliveryProvider',
	'uberDirectStoreId',
	'showExternalDeliveryFeeAmount',
	'externalDeliveryDisplayText',
	'namedAreaResolution',
	'pricePerKm',
	'baseFee',
	'minFee',
	'maxFee',
	'maxDeliveryKm',
	'freeDeliveryFromSubtotal',
	'minOrderSubtotal',
	'customerNotes',
	'trustedDriverWhatsApp',
	'allowedPaymentMethodsForDelivery',
];

function buildPatchFromBody(body) {
	const patch = {};
	for (const k of PATCH_PASSTHROUGH_KEYS) {
		if (k in body) patch[k] = body[k];
	}
	if ('zones' in body && Array.isArray(body.zones)) patch.zones = body.zones;
	if ('namedAreas' in body && Array.isArray(body.namedAreas)) patch.namedAreas = body.namedAreas;
	if (
		'beveragesUpsellEnabledByBranch' in body &&
		body.beveragesUpsellEnabledByBranch &&
		typeof body.beveragesUpsellEnabledByBranch === 'object' &&
		!Array.isArray(body.beveragesUpsellEnabledByBranch)
	) {
		patch.beveragesUpsellEnabledByBranch = body.beveragesUpsellEnabledByBranch;
	}
	if (
		'extrasEnabledByBranch' in body &&
		body.extrasEnabledByBranch &&
		typeof body.extrasEnabledByBranch === 'object' &&
		!Array.isArray(body.extrasEnabledByBranch)
	) {
		patch.extrasEnabledByBranch = body.extrasEnabledByBranch;
	}
	if ('cartBeveragesCatalog' in body && Array.isArray(body.cartBeveragesCatalog)) {
		patch.cartBeveragesCatalog = body.cartBeveragesCatalog;
	}
	if ('cartGlobalExtrasCatalog' in body && Array.isArray(body.cartGlobalExtrasCatalog)) {
		patch.cartGlobalExtrasCatalog = body.cartGlobalExtrasCatalog;
	}
	return patch;
}

/**
 * Lee el `company_id` y `integration_settings` de la company a la que pertenece la branch.
 * RLS sobre `branches` ya filtra por tenant, asi que solo necesitamos hacer un join logico
 * para saber a que `companies` pertenece y validar `allowTenantExternalDelivery`.
 *
 * @param {string} branchId
 * @returns {Promise<{ companyId: string|null, integrationSettings: unknown }>}
 */
async function getBranchCompanyContext(branchId) {
	const { data: branch } = await supabase
		.from(TABLES.branches)
		.select('company_id')
		.eq('id', branchId)
		.maybeSingle();
	const companyId = branch?.company_id ?? null;
	if (!companyId) return { companyId: null, integrationSettings: null };
	const { data: co } = await supabase
		.from(TABLES.companies)
		.select('integration_settings')
		.eq('id', companyId)
		.maybeSingle();
	return { companyId, integrationSettings: co?.integration_settings ?? null };
}

export const branchSettingsService = {
	/**
	 * (Existente) Devuelve `delivery_settings` expandido + `paymentMethods` para una sucursal.
	 * Lo siguen usando `ManualOrderModal` y `orders.js`. NO modificar shape sin coordinar.
	 *
	 * @param {string} branchId
	 * @returns {Promise<object|null>}
	 */
	getDeliveryConfig: async (branchId) => {
		if (!branchId) return null;

		const { data, error } = await supabase
			.from(TABLES.branches)
			.select('id, delivery_settings, payment_methods, is_active')
			.eq('id', branchId)
			.maybeSingle();

		if (error) throw error;
		if (!data) return null;

		const settings =
			data.delivery_settings && typeof data.delivery_settings === 'object'
				? data.delivery_settings
				: {};

		return {
			...settings,
			paymentMethods: Array.isArray(data.payment_methods) ? data.payment_methods : [],
			isBranchActive: data.is_active !== false,
		};
	},

	/**
	 * Equivalente al GET de `/api/tenant-branch-delivery-enabled`.
	 * Devuelve el payload normalizado + `originLat/Lng` + `allowTenantExternalDelivery`.
	 *
	 * @param {string} branchId
	 * @returns {Promise<object|null>} mismo shape que devolvia el endpoint legacy.
	 */
	getDeliverySettings: async (branchId) => {
		if (!branchId) return null;

		const { data: branch, error } = await supabase
			.from(TABLES.branches)
			.select('id, company_id, delivery_settings, origin_lat, origin_lng')
			.eq('id', branchId)
			.maybeSingle();

		if (error) throw error;
		if (!branch) throw new Error('Sucursal no encontrada');

		let allowTenantExternalDelivery = true;
		if (branch.company_id) {
			const { data: co } = await supabase
				.from(TABLES.companies)
				.select('integration_settings')
				.eq('id', branch.company_id)
				.maybeSingle();
			allowTenantExternalDelivery = isTenantExternalDeliveryAllowed(
				co?.integration_settings,
			);
		}

		const olat = branch.origin_lat != null ? Number(branch.origin_lat) : null;
		const olng = branch.origin_lng != null ? Number(branch.origin_lng) : null;

		return {
			...settingsResponse(branch.delivery_settings, {
				lat: Number.isFinite(olat) ? olat : null,
				lng: Number.isFinite(olng) ? olng : null,
			}),
			allowTenantExternalDelivery,
		};
	},

	/**
	 * Equivalente al PATCH de `/api/tenant-branch-delivery-enabled`.
	 * Valida external delivery si esta deshabilitado a nivel empresa, hace merge JSONB
	 * y persiste `delivery_settings` + `origin_lat/lng` con un solo UPDATE.
	 *
	 * @param {string} branchId
	 * @param {object} body
	 * @returns {Promise<object>} payload fresco con el mismo shape de getDeliverySettings.
	 */
	saveDeliverySettings: async (branchId, body) => {
		if (!branchId) throw new Error('branchId es obligatorio');
		const safeBody = body && typeof body === 'object' ? body : {};

		const patch = buildPatchFromBody(safeBody);

		const branchGeo = {};
		if ('originLat' in safeBody) {
			const v = safeBody.originLat;
			if (v === null || v === '') branchGeo.origin_lat = null;
			else {
				const n = Number(v);
				if (Number.isFinite(n)) branchGeo.origin_lat = n;
			}
		}
		if ('originLng' in safeBody) {
			const v = safeBody.originLng;
			if (v === null || v === '') branchGeo.origin_lng = null;
			else {
				const n = Number(v);
				if (Number.isFinite(n)) branchGeo.origin_lng = n;
			}
		}

		if (Object.keys(patch).length === 0 && Object.keys(branchGeo).length === 0) {
			throw new Error(
				'Nada que actualizar: envía delivery, tarifas, zonas, pagos delivery, WhatsApp repartidor, origen GPS o opciones de carrito (bebidas/extras)',
			);
		}

		const { data: row, error: loadError } = await supabase
			.from(TABLES.branches)
			.select('id, company_id, delivery_settings, origin_lat, origin_lng')
			.eq('id', branchId)
			.maybeSingle();

		if (loadError) throw loadError;
		if (!row) throw new Error('Sucursal no encontrada');

		const ctx = await getBranchCompanyContext(branchId);
		const allowExt = isTenantExternalDeliveryAllowed(ctx.integrationSettings);

		let nextSettings;
		if (Object.keys(patch).length > 0) {
			const merged = mergeDeliverySettingsJson(row.delivery_settings, patch);
			const normalized = normalizeDeliverySettings(merged);
			if (normalized.deliveryPricingStrategy === 'external' && !allowExt) {
				throw new Error(
					'Tu administrador desactivó la opción de envío externo o consultar con tienda en el panel del negocio. Elige otra estrategia de envío o contacta al soporte.',
				);
			}
			nextSettings = merged;
		} else {
			nextSettings = row.delivery_settings;
		}

		const updatePayload = {};
		if (Object.keys(patch).length > 0) updatePayload.delivery_settings = nextSettings;
		Object.assign(updatePayload, branchGeo);

		const { error: upError } = await supabase
			.from(TABLES.branches)
			.update(updatePayload)
			.eq('id', branchId);

		if (upError) throw upError;

		const { data: fresh, error: freshErr } = await supabase
			.from(TABLES.branches)
			.select('delivery_settings, origin_lat, origin_lng')
			.eq('id', branchId)
			.maybeSingle();

		if (freshErr || !fresh) {
			return {
				...settingsResponse(nextSettings),
				allowTenantExternalDelivery: allowExt,
			};
		}

		const flatLat = fresh.origin_lat != null ? Number(fresh.origin_lat) : null;
		const flatLng = fresh.origin_lng != null ? Number(fresh.origin_lng) : null;
		return {
			...settingsResponse(fresh.delivery_settings, {
				lat: Number.isFinite(flatLat) ? flatLat : null,
				lng: Number.isFinite(flatLng) ? flatLng : null,
			}),
			allowTenantExternalDelivery: allowExt,
		};
	},
};
