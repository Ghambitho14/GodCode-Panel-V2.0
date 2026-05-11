import { supabase, TABLES } from '@/integrations/supabase';

/**
 * Servicio del carrusel del menu publico (banners por sucursal + settings por empresa).
 *
 * Reemplaza al endpoint Next.js legacy `/api/tenant-menu-carousel` que en
 * `proyecto viejo` (panel-viejo/app/api/tenant-menu-carousel/route.ts) consultaba
 * y escribia con `supabaseAdmin` (bypass de RLS) sobre:
 *  - `hero_banners`            (1 fila por banner por sucursal)
 *  - `companies.theme_config`  (subkey JSONB `menuCarousel` con intervalMs/maxSlides)
 *
 * En GodCode-panel el front habla directo a Supabase con el JWT del usuario logueado;
 * la autorizacion la aplica RLS (`hero_banners_tenant_access` filtra por company_id
 * del usuario via `current_user_profile()`). Las imagenes siguen subiendo a Cloudinary
 * desde el componente; aca solo viaja la URL ya cargada.
 */

/** Fecha lejana para banners "sin caducidad" (la columna expires_at es NOT NULL en BD). */
const DEFAULT_EXPIRES = '2099-12-31T23:59:59.000Z';

const MAX_BANNERS_PER_BRANCH = 20;

const MIN_INTERVAL_MS = 2000;
const MAX_INTERVAL_MS = 60000;
const DEFAULT_INTERVAL_MS = 5000;

const MIN_MAX_SLIDES = 1;
const MAX_MAX_SLIDES = 20;
const DEFAULT_MAX_SLIDES = 10;

const MIN_PROMOTION_DAYS = 1;
const MAX_PROMOTION_DAYS = 90;
const DEFAULT_PROMOTION_DAYS = 7;

/** Columnas que devuelve cada operacion (mismo set que el endpoint viejo). */
const BANNER_SELECT =
	'id, branch_id, company_id, sort_order, is_active, created_at, image_url, expires_at, promotion_duration_enabled, promotion_duration_days';

/**
 * @param {unknown} raw
 * @returns {number}
 */
function clampPromotionDays(raw) {
	const n = Number(raw);
	if (!Number.isFinite(n)) return DEFAULT_PROMOTION_DAYS;
	return Math.min(MAX_PROMOTION_DAYS, Math.max(MIN_PROMOTION_DAYS, Math.round(n)));
}

/**
 * @param {{ intervalMs?: unknown, maxSlides?: unknown }} raw
 * @returns {{ intervalMs: number, maxSlides: number }}
 */
function clampMenuCarouselSettings(raw) {
	const intervalMs = Number(raw?.intervalMs);
	const maxSlides = Number(raw?.maxSlides);
	const safeInterval = Number.isFinite(intervalMs)
		? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(intervalMs)))
		: DEFAULT_INTERVAL_MS;
	const safeMax = Number.isFinite(maxSlides)
		? Math.min(MAX_MAX_SLIDES, Math.max(MIN_MAX_SLIDES, Math.round(maxSlides)))
		: DEFAULT_MAX_SLIDES;
	return { intervalMs: safeInterval, maxSlides: safeMax };
}

/**
 * @param {unknown} mc
 * @returns {{ intervalMs: number, maxSlides: number }}
 */
function normalizeMenuCarouselBlock(mc) {
	const o = mc && typeof mc === 'object' && !Array.isArray(mc) ? mc : {};
	return clampMenuCarouselSettings(o);
}

/**
 * @param {number} days
 * @returns {string}
 */
function expiresAtFromPromotionDays(days) {
	const end = new Date();
	end.setUTCDate(end.getUTCDate() + days);
	return end.toISOString();
}

/**
 * Lee banners de una sucursal + settings del carrusel de la empresa.
 *
 * @param {{ branchId: string, companyId: string }} args
 * @returns {Promise<{ banners: any[], settings: { intervalMs: number, maxSlides: number } }>}
 */
export async function listMenuCarousel({ branchId, companyId } = {}) {
	if (!branchId) throw new Error('Falta branchId');
	if (!companyId) throw new Error('Falta companyId');

	const [bannersRes, companyRes] = await Promise.all([
		supabase
			.from(TABLES.hero_banners)
			.select(BANNER_SELECT)
			.eq('branch_id', branchId)
			.eq('company_id', companyId)
			.order('sort_order', { ascending: true }),
		supabase
			.from(TABLES.companies)
			.select('theme_config')
			.eq('id', companyId)
			.maybeSingle(),
	]);

	if (bannersRes.error) {
		throw new Error(bannersRes.error.message || 'No se pudieron cargar los banners');
	}
	if (companyRes.error) {
		throw new Error(companyRes.error.message || 'No se pudo cargar la configuracion');
	}

	const themeConfig = (companyRes.data?.theme_config ?? {});
	const settings = normalizeMenuCarouselBlock(themeConfig?.menuCarousel);

	return { banners: bannersRes.data ?? [], settings };
}

/**
 * Crea un banner nuevo en la sucursal con la URL de Cloudinary ya subida.
 * Hace defensa basica del lado del panel (max banners y siguiente sort_order)
 * pero la autorizacion final la aplica RLS.
 *
 * @param {{
 *   branchId: string,
 *   companyId: string,
 *   imageUrl: string,
 *   promoEnabled?: boolean,
 *   promoDays?: number,
 * }} args
 * @returns {Promise<any>}
 */
export async function createBanner({
	branchId,
	companyId,
	imageUrl,
	promoEnabled = false,
	promoDays,
} = {}) {
	if (!branchId) throw new Error('Falta branchId');
	if (!companyId) throw new Error('Falta companyId');
	const trimmedUrl = String(imageUrl ?? '').trim();
	if (!trimmedUrl) throw new Error('Falta imageUrl');

	const { count, error: countError } = await supabase
		.from(TABLES.hero_banners)
		.select('id', { count: 'exact', head: true })
		.eq('branch_id', branchId)
		.eq('company_id', companyId);

	if (countError) {
		throw new Error(countError.message || 'No se pudo contar los banners');
	}
	if ((count ?? 0) >= MAX_BANNERS_PER_BRANCH) {
		throw new Error(`Maximo ${MAX_BANNERS_PER_BRANCH} imagenes por sucursal`);
	}

	const { data: maxRow, error: maxError } = await supabase
		.from(TABLES.hero_banners)
		.select('sort_order')
		.eq('branch_id', branchId)
		.eq('company_id', companyId)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (maxError) {
		throw new Error(maxError.message || 'No se pudo calcular el orden');
	}

	const nextOrder = typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;
	const promoOn = promoEnabled === true;
	const days = clampPromotionDays(promoDays);
	const expiresAt = promoOn ? expiresAtFromPromotionDays(days) : DEFAULT_EXPIRES;

	const { data: inserted, error: insertError } = await supabase
		.from(TABLES.hero_banners)
		.insert({
			branch_id: branchId,
			company_id: companyId,
			image_url: trimmedUrl,
			sort_order: nextOrder,
			expires_at: expiresAt,
			is_active: true,
			promotion_duration_enabled: promoOn,
			promotion_duration_days: promoOn ? days : null,
		})
		.select(BANNER_SELECT)
		.maybeSingle();

	if (insertError || !inserted) {
		throw new Error(insertError?.message || 'No se pudo crear el banner');
	}

	return inserted;
}

/**
 * Actualiza el sort_order para reflejar la lista nueva.
 * Valida que orderedIds sea exactamente el set de banners de la sucursal.
 *
 * @param {{ branchId: string, companyId: string, orderedIds: string[] }} args
 * @returns {Promise<{ ok: true }>}
 */
export async function reorderBanners({ branchId, companyId, orderedIds } = {}) {
	if (!branchId) throw new Error('Falta branchId');
	if (!companyId) throw new Error('Falta companyId');
	const ordered = Array.isArray(orderedIds) ? orderedIds.filter(Boolean) : [];
	if (ordered.length === 0) throw new Error('Faltan orderedIds');

	const { data: existing, error: listError } = await supabase
		.from(TABLES.hero_banners)
		.select('id')
		.eq('branch_id', branchId)
		.eq('company_id', companyId);

	if (listError) {
		throw new Error(listError.message || 'No se pudo validar el orden');
	}

	const valid = new Set((existing ?? []).map((r) => r.id));
	const filtered = ordered.filter((id) => valid.has(id));
	if (filtered.length !== valid.size) {
		throw new Error('La lista de ids no coincide con los banners de la sucursal');
	}

	for (let i = 0; i < filtered.length; i += 1) {
		const id = filtered[i];
		const { error: uErr } = await supabase
			.from(TABLES.hero_banners)
			.update({ sort_order: i })
			.eq('id', id)
			.eq('company_id', companyId);

		if (uErr) {
			throw new Error(uErr.message || 'No se pudo reordenar');
		}
	}

	return { ok: true };
}

/**
 * Mergea intervalMs y maxSlides en companies.theme_config.menuCarousel
 * preservando el resto de claves del theme (primaryColor, secondaryColor, etc).
 *
 * @param {{ companyId: string, intervalMs: number, maxSlides: number }} args
 * @returns {Promise<{ intervalMs: number, maxSlides: number }>}
 */
export async function saveCarouselSettings({ companyId, intervalMs, maxSlides } = {}) {
	if (!companyId) throw new Error('Falta companyId');

	const clamped = clampMenuCarouselSettings({ intervalMs, maxSlides });

	const { data: company, error: loadError } = await supabase
		.from(TABLES.companies)
		.select('theme_config')
		.eq('id', companyId)
		.maybeSingle();

	if (loadError || !company) {
		throw new Error(loadError?.message || 'Empresa no encontrada');
	}

	const prev =
		company.theme_config && typeof company.theme_config === 'object' && !Array.isArray(company.theme_config)
			? { ...company.theme_config }
			: {};

	const prevMc =
		prev.menuCarousel && typeof prev.menuCarousel === 'object' && !Array.isArray(prev.menuCarousel)
			? { ...prev.menuCarousel }
			: {};

	delete prevMc.promotionDurationEnabled;
	delete prevMc.promotionDurationDays;

	const nextTheme = {
		...prev,
		menuCarousel: {
			...prevMc,
			intervalMs: clamped.intervalMs,
			maxSlides: clamped.maxSlides,
		},
	};

	const { error: upError } = await supabase
		.from(TABLES.companies)
		.update({ theme_config: nextTheme })
		.eq('id', companyId);

	if (upError) {
		throw new Error(upError.message || 'No se pudo guardar la configuracion');
	}

	return clamped;
}

/**
 * Actualiza un banner especifico. Acepta is_active, image_url, promotion_*.
 * Si toca campos de promo, recalcula expires_at correctamente.
 *
 * @param {{
 *   bannerId: string,
 *   companyId: string,
 *   patches: {
 *     is_active?: boolean,
 *     image_url?: string,
 *     promotion_duration_enabled?: boolean,
 *     promotion_duration_days?: number,
 *   },
 * }} args
 * @returns {Promise<any | null>}
 */
export async function patchBanner({ bannerId, companyId, patches } = {}) {
	if (!bannerId) throw new Error('Falta bannerId');
	if (!companyId) throw new Error('Falta companyId');
	if (!patches || typeof patches !== 'object') throw new Error('Faltan patches');

	const { data: current, error: findError } = await supabase
		.from(TABLES.hero_banners)
		.select('id, company_id, promotion_duration_enabled, promotion_duration_days')
		.eq('id', bannerId)
		.eq('company_id', companyId)
		.maybeSingle();

	if (findError || !current) {
		throw new Error(findError?.message || 'Banner no encontrado');
	}

	let promoEnabled = Boolean(current.promotion_duration_enabled);
	let promoDays = clampPromotionDays(current.promotion_duration_days);

	if (typeof patches.promotion_duration_enabled === 'boolean') {
		promoEnabled = patches.promotion_duration_enabled;
	}
	if (patches.promotion_duration_days !== undefined && patches.promotion_duration_days !== null) {
		promoDays = clampPromotionDays(patches.promotion_duration_days);
	}

	/** @type {Record<string, unknown>} */
	const patch = {};

	if (typeof patches.is_active === 'boolean') {
		patch.is_active = patches.is_active;
	}
	if (typeof patches.image_url === 'string' && patches.image_url.trim().length > 0) {
		patch.image_url = patches.image_url.trim();
	}

	const promoFieldsSent =
		typeof patches.promotion_duration_enabled === 'boolean' ||
		(patches.promotion_duration_days !== undefined && patches.promotion_duration_days !== null);

	if (promoFieldsSent) {
		patch.promotion_duration_enabled = promoEnabled;
		patch.promotion_duration_days = promoEnabled ? promoDays : null;
		patch.expires_at = promoEnabled ? expiresAtFromPromotionDays(promoDays) : DEFAULT_EXPIRES;
	}

	if (Object.keys(patch).length === 0) {
		throw new Error('Nada que actualizar');
	}

	const { data: updated, error: upError } = await supabase
		.from(TABLES.hero_banners)
		.update(patch)
		.eq('id', bannerId)
		.eq('company_id', companyId)
		.select(BANNER_SELECT)
		.maybeSingle();

	if (upError) {
		throw new Error(upError.message || 'No se pudo actualizar el banner');
	}

	return updated ?? null;
}

/**
 * Elimina un banner. RLS ya filtra por company_id, igual filtramos en defensa.
 *
 * @param {{ bannerId: string, companyId: string }} args
 * @returns {Promise<{ ok: true }>}
 */
export async function deleteBanner({ bannerId, companyId } = {}) {
	if (!bannerId) throw new Error('Falta bannerId');
	if (!companyId) throw new Error('Falta companyId');

	const { error } = await supabase
		.from(TABLES.hero_banners)
		.delete()
		.eq('id', bannerId)
		.eq('company_id', companyId);

	if (error) {
		throw new Error(error.message || 'No se pudo eliminar el banner');
	}

	return { ok: true };
}
