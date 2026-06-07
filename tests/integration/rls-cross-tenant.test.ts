import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = String(
	process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
).trim();
const supabaseAnonKey = String(
	process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
).trim();

const tenantAEmail = String(process.env.E2E_EMAIL ?? "").trim();
const tenantAPassword = String(process.env.E2E_PASSWORD ?? "").trim();
const tenantBEmail = String(process.env.E2E_TENANT_B_EMAIL ?? "").trim();
const tenantBPassword = String(process.env.E2E_TENANT_B_PASSWORD ?? "").trim();

const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);
const hasTenantPair = Boolean(
	tenantAEmail && tenantAPassword && tenantBEmail && tenantBPassword,
);

function createEphemeralClient(): SupabaseClient {
	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

async function signInClient(
	email: string,
	password: string,
): Promise<SupabaseClient> {
	const client = createEphemeralClient();
	const { error } = await client.auth.signInWithPassword({ email, password });
	if (error) {
		throw new Error(`signIn failed for ${email}: ${error.message}`);
	}
	return client;
}

describe.skipIf(!hasSupabase || !hasTenantPair)(
	"RLS cross-tenant (staging)",
	() => {
		let tenantBOrderId: number | null = null;
		let tenantBCompanyId: string | null = null;

		beforeAll(async () => {
			const clientB = await signInClient(tenantBEmail, tenantBPassword);
			const { data: ordersB, error } = await clientB
				.from("orders")
				.select("id, company_id")
				.order("created_at", { ascending: false })
				.limit(1);

			if (error) {
				throw new Error(`tenant B orders probe failed: ${error.message}`);
			}

			tenantBOrderId = ordersB?.[0]?.id ?? null;
			tenantBCompanyId = ordersB?.[0]?.company_id ?? null;

			if (!tenantBOrderId || !tenantBCompanyId) {
				throw new Error(
					"tenant B fixture missing: seed at least one order for E2E_TENANT_B_EMAIL",
				);
			}

			await clientB.auth.signOut();
		});

		it("tenant A cannot read tenant B orders by company_id", async () => {
			const clientA = await signInClient(tenantAEmail, tenantAPassword);
			const { data, error } = await clientA
				.from("orders")
				.select("id")
				.eq("company_id", tenantBCompanyId!);

			expect(error).toBeNull();
			expect(data ?? []).toHaveLength(0);
			await clientA.auth.signOut();
		});

		it("tenant A cannot read tenant B order by id", async () => {
			const clientA = await signInClient(tenantAEmail, tenantAPassword);
			const { data, error } = await clientA
				.from("orders")
				.select("id, company_id")
				.eq("id", tenantBOrderId!)
				.maybeSingle();

			expect(error).toBeNull();
			expect(data).toBeNull();
			await clientA.auth.signOut();
		});

		it("tenant A cannot update tenant B order", async () => {
			const clientA = await signInClient(tenantAEmail, tenantAPassword);
			const { data, error } = await clientA
				.from("orders")
				.update({ note: "[rls-cross-tenant probe]" })
				.eq("id", tenantBOrderId!)
				.select("id");

			if (error) {
				expect(error.code === "42501" || /policy|permission/i.test(error.message)).toBe(
					true,
				);
			} else {
				expect(data ?? []).toHaveLength(0);
			}
			await clientA.auth.signOut();
		});
	},
);

describe("RLS cross-tenant env gate", () => {
	it("documents required env vars when fixtures are absent", () => {
		if (hasSupabase && hasTenantPair) return;
		expect(true).toBe(true);
	});
});
