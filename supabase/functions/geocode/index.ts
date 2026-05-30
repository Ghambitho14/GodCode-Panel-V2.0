/**
 * Edge Function: geocode
 *
 * Reemplaza al endpoint Next.js legacy `/api/delivery-geocode` (panel-viejo)
 * y al endpoint paralelo `GodCode-Saas/app/api/geo/delivery-geocode/route.ts`.
 *
 * El front (`GodCode-panel`) la invoca con `supabase.functions.invoke('geocode', { body })`,
 * que adjunta automaticamente `Authorization: Bearer <jwt>` del usuario logueado.
 *
 * POST  body { branchId, address }  ->  resuelve una direccion en texto a una zona
 *                                        configurada en `branches.delivery_settings.namedAreas`
 *                                        (modo `named_areas` + `address_matched`).
 *
 * Respuesta exitosa (200):
 *   { ok: true, namedAreaId: string, label: string }
 * Respuesta de error de negocio (400/404/409):
 *   { ok: false, code: 'short_address'|'geocode_failed'|'no_match'|'ambiguous', message: string }
 *
 * El calculo de tarifa NO se hace aca: el cliente ya tiene `computeDeliveryFee`
 * en `src/lib/delivery-settings.ts` y se ejecuta automaticamente al setear
 * `delivery_named_area_id` en el estado del modal. Esto evita duplicar logica
 * de cobro en Deno.
 *
 * Auth model:
 *  - `verify_jwt=true` en el deploy: Supabase rechaza el request si el JWT no es valido.
 *  - Para resolver email -> users.company_id/role y leer companies/branches se usa
 *    SUPABASE_SERVICE_ROLE_KEY (mismo modelo que `tenant-broadcasts`/`tenant-tickets`).
 *  - Tenant guard: el branchId solicitado debe pertenecer a la company del JWT.
 *
 * Provider de geocoding: Photon (Komoot/OSM), publico, sin API key.
 * Cero rate-limit / cache: panel interno autenticado, Photon es gratis,
 * Deno serverless no persiste memoria util.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

const PHOTON_URL = "https://photon.komoot.io/api/";
const MIN_ADDRESS_LEN = 8;

type TenantContext = {
	admin: SupabaseClient;
	companyId: string;
	email: string;
};

type ContextError = { error: string; status: number };

type DeliveryNamedArea = {
	id: string;
	name: string;
	aliases?: string[];
};

const TENANT_ALLOWED_ROLES = new Set(["admin", "ceo", "cashier", "staff"]);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body ?? {}), {
		status,
		headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
	});
}

function getEnv(name: string): string {
	const value = Deno.env.get(name);
	if (!value) {
		throw new Error(`Falta variable de entorno: ${name}`);
	}
	return value;
}

function getAdminClient(): SupabaseClient {
	return createClient(
		getEnv("SUPABASE_URL"),
		getEnv("SUPABASE_SERVICE_ROLE_KEY"),
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
}

async function resolveAuthEmail(
	authHeader: string | null,
): Promise<{ email: string } | ContextError> {
	if (!authHeader) {
		return { error: "No autenticado", status: 401 };
	}
	const userClient = createClient(
		getEnv("SUPABASE_URL"),
		getEnv("SUPABASE_ANON_KEY"),
		{
			global: { headers: { Authorization: authHeader } },
			auth: { persistSession: false, autoRefreshToken: false },
		},
	);
	const { data, error } = await userClient.auth.getUser();
	if (error || !data.user?.email) {
		return { error: "No autenticado", status: 401 };
	}
	return { email: data.user.email.trim().toLowerCase() };
}

async function getTenantContext(
	authHeader: string | null,
): Promise<TenantContext | ContextError> {
	const auth = await resolveAuthEmail(authHeader);
	if ("error" in auth) return auth;

	const admin = getAdminClient();

	const { data: rows, error: usersError } = await admin
		.from("users")
		.select("id, company_id, role")
		.ilike("email", auth.email);

	if (usersError) {
		return { error: usersError.message, status: 500 };
	}

	const userRow = (rows ?? []).find(
		(row: { role: string | null; company_id: string | null }) =>
			TENANT_ALLOWED_ROLES.has(String(row.role || "").toLowerCase()),
	);

	if (!userRow?.company_id) {
		return { error: "No tienes permisos de panel tenant", status: 403 };
	}

	return {
		admin,
		companyId: String(userRow.company_id),
		email: auth.email,
	};
}

/* ============================================================
 * Parse de delivery_settings (subset minimo del normalizer del cliente).
 * Solo necesitamos validar modo y leer namedAreas (id+name+aliases).
 * El resto (fees, etc.) lo recalcula el cliente con computeDeliveryFee.
 * ============================================================ */

function parseNamedAreas(raw: unknown): DeliveryNamedArea[] {
	if (!Array.isArray(raw)) return [];
	const out: DeliveryNamedArea[] = [];
	for (let i = 0; i < raw.length && out.length < 200; i++) {
		const row = raw[i];
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const o = row as Record<string, unknown>;
		const nameRaw = o.name ?? o.label ?? o.place ?? o.title;
		const name =
			typeof nameRaw === "string" ? nameRaw.trim().slice(0, 120) : "";
		if (!name) continue;
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
				.slice(0, 8);
			if (al.length > 0) aliases = al;
		}
		const area: DeliveryNamedArea = { id, name };
		if (aliases) area.aliases = aliases;
		out.push(area);
	}
	return out;
}

function isNamedAreasStrategy(rawStrategy: unknown): boolean {
	const v = typeof rawStrategy === "string" ? rawStrategy.trim().toLowerCase() : "";
	return v === "named_areas" || v === "namedareas" || v === "named";
}

function isAddressMatchedResolution(rawResolution: unknown): boolean {
	const v = typeof rawResolution === "string" ? rawResolution.trim().toLowerCase() : "";
	return v === "address_matched" || v === "address" || v === "auto";
}

/* ============================================================
 * Matcher fuzzy (portado literal de panel-viejo/lib/delivery-area-resolve.ts)
 * ============================================================ */

function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9áéíóúüñ\s]/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function collectGeocodeStrings(props: Record<string, unknown>): string[] {
	const keys = [
		"name",
		"city",
		"district",
		"locality",
		"county",
		"state",
		"country",
	] as const;
	const out: string[] = [];
	for (const k of keys) {
		const v = props[k];
		if (typeof v === "string" && v.trim()) out.push(v.trim());
	}
	return out;
}

function areaSearchStrings(area: DeliveryNamedArea): string[] {
	const out = [area.name];
	const aliases = area.aliases;
	if (Array.isArray(aliases)) {
		for (const a of aliases) {
			if (typeof a === "string" && a.trim()) out.push(a.trim());
		}
	}
	return out;
}

function scoreAreaAgainstBlob(
	area: DeliveryNamedArea,
	blobNorm: string,
	tokens: Set<string>,
): number {
	let best = 0;
	for (const raw of areaSearchStrings(area)) {
		const n = norm(raw);
		if (!n) continue;
		if (blobNorm.includes(n) || n.includes(blobNorm)) {
			best = Math.max(best, 100 + n.length);
			continue;
		}
		const areaTokens = new Set(n.split(" ").filter((t) => t.length > 2));
		let overlap = 0;
		for (const t of areaTokens) {
			if (tokens.has(t)) overlap += 10;
		}
		best = Math.max(best, overlap);
	}
	return best;
}

async function photonForwardGeocode(
	address: string,
): Promise<Record<string, unknown>[] | null> {
	const q = address.trim();
	if (q.length < MIN_ADDRESS_LEN) return null;
	const url = new URL(PHOTON_URL);
	url.searchParams.set("q", q.slice(0, 200));
	url.searchParams.set("lang", "default");
	url.searchParams.set("limit", "8");
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 12_000);
	try {
		const res = await fetch(url.toString(), {
			signal: ctrl.signal,
			cache: "no-store",
			headers: { Accept: "application/json" },
		});
		clearTimeout(t);
		if (!res.ok) return null;
		const data = (await res.json()) as { features?: unknown[] };
		const feats = Array.isArray(data.features) ? data.features : [];
		const props: Record<string, unknown>[] = [];
		for (const f of feats) {
			if (!f || typeof f !== "object") continue;
			const p = (f as { properties?: unknown }).properties;
			if (p && typeof p === "object" && !Array.isArray(p)) {
				props.push(p as Record<string, unknown>);
			}
		}
		return props.length > 0 ? props : null;
	} catch {
		clearTimeout(t);
		return null;
	}
}

/* ============================================================
 * Handler principal
 * ============================================================ */

async function handleGeocode(
	req: Request,
	ctx: TenantContext,
): Promise<Response> {
	let body: { branchId?: unknown; address?: unknown };
	try {
		body = await req.json();
	} catch {
		return jsonResponse({ ok: false, error: "JSON invalido" }, 400);
	}

	const branchId =
		typeof body.branchId === "string" ? body.branchId.trim() : "";
	const address =
		typeof body.address === "string" ? body.address.trim() : "";

	if (!branchId) {
		return jsonResponse({ ok: false, error: "Falta branchId" }, 400);
	}
	if (address.length < MIN_ADDRESS_LEN) {
		return jsonResponse(
			{
				ok: false,
				code: "short_address",
				message:
					"Escribe una direccion mas completa (calle, numero y comuna o ciudad).",
			},
			400,
		);
	}

	// Tenant guard: la sucursal debe pertenecer a la company del JWT.
	const { data: branch, error: branchError } = await ctx.admin
		.from("branches")
		.select("id, company_id, delivery_settings")
		.eq("id", branchId)
		.eq("company_id", ctx.companyId)
		.maybeSingle();

	if (branchError) {
		return jsonResponse({ ok: false, error: branchError.message }, 500);
	}
	if (!branch) {
		return jsonResponse(
			{ ok: false, error: "Sucursal no encontrada" },
			404,
		);
	}

	const settings = (branch.delivery_settings ?? {}) as Record<string, unknown>;
	if (settings.enabled === false) {
		return jsonResponse(
			{
				ok: false,
				code: "no_match",
				message: "Delivery no disponible en esta sucursal.",
			},
			400,
		);
	}

	const strategyRaw =
		settings.deliveryPricingStrategy ??
		settings.delivery_pricing_strategy ??
		settings.pricingMode ??
		settings.pricing_mode;
	if (!isNamedAreasStrategy(strategyRaw)) {
		return jsonResponse(
			{
				ok: false,
				code: "no_match",
				message:
					"Esta sucursal no cotiza por zonas; cambia el modo de delivery o elige otro metodo.",
			},
			400,
		);
	}

	const resolutionRaw =
		settings.namedAreaResolution ?? settings.named_area_resolution;
	if (!isAddressMatchedResolution(resolutionRaw)) {
		return jsonResponse(
			{
				ok: false,
				code: "no_match",
				message:
					"Esta sucursal usa lista de zonas manual; elige la zona desde el selector.",
			},
			400,
		);
	}

	const namedAreasRaw =
		settings.namedAreas ??
		settings.named_areas ??
		settings.delivery_places ??
		settings.places;
	const areas = parseNamedAreas(namedAreasRaw);
	if (areas.length === 0) {
		return jsonResponse(
			{
				ok: false,
				code: "no_match",
				message:
					"Esta sucursal no tiene zonas por nombre configuradas.",
			},
			400,
		);
	}

	const geoPropsList = await photonForwardGeocode(address);
	if (!geoPropsList || geoPropsList.length === 0) {
		return jsonResponse(
			{
				ok: false,
				code: "geocode_failed",
				message:
					"No pudimos ubicar esa direccion. Revisa e intenta de nuevo.",
			},
			404,
		);
	}

	const allStrings: string[] = [];
	for (const props of geoPropsList) {
		allStrings.push(...collectGeocodeStrings(props));
	}
	const blob = allStrings.join(" · ");
	const blobNorm = norm(blob);
	const tokenSet = new Set(blobNorm.split(" ").filter((x) => x.length > 2));

	let bestScore = 0;
	const scored: { area: DeliveryNamedArea; s: number }[] = [];
	for (const area of areas) {
		const s = scoreAreaAgainstBlob(area, blobNorm, tokenSet);
		scored.push({ area, s });
		bestScore = Math.max(bestScore, s);
	}

	const winners = scored.filter((x) => x.s === bestScore && x.s >= 10);
	if (winners.length === 0) {
		return jsonResponse(
			{
				ok: false,
				code: "no_match",
				message:
					"No reconocemos esa zona en la lista del local. Elige otra direccion o selecciona la zona manualmente.",
			},
			404,
		);
	}
	if (winners.length > 1) {
		return jsonResponse(
			{
				ok: false,
				code: "ambiguous",
				message:
					"Hay varias zonas posibles. Anade mas detalle a la direccion (comuna o ciudad) o selecciona la zona manualmente.",
			},
			409,
		);
	}

	const winner = winners[0].area;
	return jsonResponse({
		ok: true,
		namedAreaId: winner.id,
		label: winner.name,
	});
}

Deno.serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	if (req.method !== "POST") {
		return jsonResponse({ ok: false, error: "Metodo no permitido" }, 405);
	}

	try {
		const ctx = await getTenantContext(req.headers.get("Authorization"));
		if ("error" in ctx) {
			return jsonResponse({ ok: false, error: ctx.error }, ctx.status);
		}
		return await handleGeocode(req, ctx);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Error interno";
		return jsonResponse({ ok: false, error: message }, 500);
	}
});
