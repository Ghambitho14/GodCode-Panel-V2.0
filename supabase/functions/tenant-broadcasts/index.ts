/**
 * Edge Function: tenant-broadcasts
 *
 * Reemplaza al endpoint Next.js legacy `/api/tenant-broadcasts` (panel-viejo)
 * y al endpoint paralelo `GodCode-Saas/app/api/tenant/broadcasts/route.ts`.
 *
 * El front (`GodCode-panel`) la invoca con `supabase.functions.invoke('tenant-broadcasts')`,
 * que adjunta automaticamente el header `Authorization: Bearer <jwt>` del usuario logueado.
 *
 * GET  -> devuelve los broadcasts activos visibles para la company del usuario,
 *         con `readAt` (timestamp del acuse) o null.
 * POST -> body { broadcastId } -> upsert de acuse en `saas_broadcast_reads`.
 *
 * Auth model:
 *  - `verify_jwt=true` en el deploy: Supabase rechaza el request si el JWT no es valido
 *    antes de invocar la function.
 *  - Para resolver email -> users.company_id/role y leer companies/saas_broadcasts/
 *    saas_broadcast_reads se usa SUPABASE_SERVICE_ROLE_KEY (mismo modelo que el
 *    endpoint del SaaS), porque:
 *      * `users` no permite leer otros perfiles via RLS;
 *      * `saas_broadcast_reads` no tiene policy INSERT para autenticados.
 *
 * Cero dependencia de cookies del SaaS, cero CORS cross-domain con el SaaS.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.0";

type BroadcastRow = {
	id: string;
	title: string;
	message: string;
	broadcast_type: "general" | "maintenance" | "incident" | "billing" | "release";
	priority: "low" | "medium" | "high" | "critical";
	target_scope: "all" | "plans" | "companies" | "subdomains";
	target_plan_ids: string[] | null;
	target_company_ids: string[] | null;
	target_subdomains: string[] | null;
	starts_at: string;
	ends_at: string | null;
	requires_ack: boolean;
	is_active: boolean;
	created_at: string;
};

type TenantContext = {
	admin: SupabaseClient;
	companyId: string;
	companyPlanId: string | null;
	companySlug: string;
	email: string;
};

type ContextError = { error: string; status: number };

const TENANT_ALLOWED_ROLES = new Set(["admin", "ceo", "cashier", "staff"]);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

	const { data: company, error: companyError } = await admin
		.from("companies")
		.select("id, plan_id, public_slug")
		.eq("id", userRow.company_id)
		.maybeSingle();

	if (companyError || !company) {
		return {
			error: companyError?.message || "No se encontro la empresa",
			status: 404,
		};
	}

	return {
		admin,
		companyId: company.id as string,
		companyPlanId: (company.plan_id ?? null) as string | null,
		companySlug: String(company.public_slug || "").toLowerCase(),
		email: auth.email,
	};
}

function shouldIncludeBroadcast(
	item: BroadcastRow,
	ctx: Pick<TenantContext, "companyId" | "companyPlanId" | "companySlug">,
): boolean {
	if (!item.is_active) return false;

	const scope = item.target_scope;
	if (scope === "all") return true;

	if (scope === "companies") {
		const ids = Array.isArray(item.target_company_ids)
			? item.target_company_ids
			: [];
		return ids.includes(ctx.companyId);
	}

	if (scope === "plans") {
		const planIds = Array.isArray(item.target_plan_ids)
			? item.target_plan_ids
			: [];
		return !!ctx.companyPlanId && planIds.includes(ctx.companyPlanId);
	}

	if (scope === "subdomains") {
		const slugs = Array.isArray(item.target_subdomains)
			? item.target_subdomains.map((slug) => String(slug).toLowerCase())
			: [];
		return !!ctx.companySlug && slugs.includes(ctx.companySlug);
	}

	return false;
}

const BROADCAST_SELECT =
	"id, title, message, broadcast_type, priority, target_scope, target_plan_ids, target_company_ids, target_subdomains, starts_at, ends_at, requires_ack, is_active, created_at";

async function handleGet(ctx: TenantContext): Promise<Response> {
	const nowIso = new Date().toISOString();

	const { data, error } = await ctx.admin
		.from("saas_broadcasts")
		.select(BROADCAST_SELECT)
		.eq("is_active", true)
		.lte("starts_at", nowIso)
		.or(`ends_at.is.null,ends_at.gte.${nowIso}`)
		.order("priority", { ascending: false })
		.order("starts_at", { ascending: false });

	if (error) {
		return jsonResponse({ error: error.message }, 400);
	}

	const visible = ((data ?? []) as BroadcastRow[]).filter((item) =>
		shouldIncludeBroadcast(item, ctx),
	);
	const ids = visible.map((item) => item.id);
	const readMap = new Map<string, string>();

	if (ids.length > 0) {
		const { data: reads, error: readsError } = await ctx.admin
			.from("saas_broadcast_reads")
			.select("broadcast_id, read_at")
			.eq("company_id", ctx.companyId)
			.eq("email", ctx.email)
			.in("broadcast_id", ids);

		if (!readsError && Array.isArray(reads)) {
			for (const row of reads as { broadcast_id: string; read_at: string }[]) {
				readMap.set(row.broadcast_id, row.read_at);
			}
		}
	}

	return jsonResponse({
		broadcasts: visible.map((item) => ({
			id: item.id,
			title: item.title,
			message: item.message,
			broadcastType: item.broadcast_type,
			priority: item.priority,
			startsAt: item.starts_at,
			endsAt: item.ends_at,
			requiresAck: item.requires_ack,
			readAt: readMap.get(item.id) ?? null,
		})),
	});
}

async function handlePost(req: Request, ctx: TenantContext): Promise<Response> {
	let body: { broadcastId?: unknown };
	try {
		body = await req.json();
	} catch {
		return jsonResponse({ error: "JSON invalido" }, 400);
	}

	const broadcastId = String(body.broadcastId ?? "").trim();
	if (!broadcastId) {
		return jsonResponse({ error: "Falta broadcastId" }, 400);
	}

	const { data: broadcast, error: broadcastError } = await ctx.admin
		.from("saas_broadcasts")
		.select(BROADCAST_SELECT)
		.eq("id", broadcastId)
		.maybeSingle();

	if (broadcastError || !broadcast) {
		return jsonResponse(
			{ error: broadcastError?.message || "Comunicado no encontrado" },
			404,
		);
	}

	if (!shouldIncludeBroadcast(broadcast as BroadcastRow, ctx)) {
		return jsonResponse(
			{ error: "No autorizado para este comunicado" },
			403,
		);
	}

	const { error: upsertError } = await ctx.admin
		.from("saas_broadcast_reads")
		.upsert(
			{
				broadcast_id: broadcastId,
				company_id: ctx.companyId,
				email: ctx.email,
				read_at: new Date().toISOString(),
			},
			{ onConflict: "broadcast_id,company_id,email" },
		);

	if (upsertError) {
		return jsonResponse({ error: upsertError.message }, 400);
	}

	return jsonResponse({ success: true });
}

Deno.serve(async (req: Request): Promise<Response> => {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	if (req.method !== "GET" && req.method !== "POST") {
		return jsonResponse({ error: "Metodo no permitido" }, 405);
	}

	try {
		const ctx = await getTenantContext(req.headers.get("Authorization"));
		if ("error" in ctx) {
			return jsonResponse({ error: ctx.error }, ctx.status);
		}

		if (req.method === "GET") {
			return await handleGet(ctx);
		}

		return await handlePost(req, ctx);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Error interno";
		return jsonResponse({ error: message }, 500);
	}
});
