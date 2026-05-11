import type { SupabaseClient } from "@supabase/supabase-js";

export type DiscountCouponRow = {
	id: string;
	company_id: string;
	code: string;
	discount_type: string;
	discount_value: number;
	scope: string;
	restricted_client_id: string | null;
	min_order_subtotal: number | null;
	max_redemptions: number | null;
	redemptions_count: number | null;
	max_redemptions_per_client: number | null;
	valid_from: string | null;
	valid_until: string | null;
	is_active: boolean;
};

export function normalizeCouponCode(code: string | null | undefined): string {
	return String(code ?? "").trim();
}

export function couponCodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
	return normalizeCouponCode(a).toUpperCase() === normalizeCouponCode(b).toUpperCase();
}

/** Replica la cuenta de la RPC `create_order_transaction` (truncado monetario estándar). */
export function computeCouponDiscountAmount(subtotal: number, row: DiscountCouponRow): number {
	const s = Math.max(0, Number(subtotal) || 0);
	if (row.discount_type === "percent") {
		const p = Math.min(100, Math.max(0, Number(row.discount_value) || 0));
		return Math.round((s * (p / 100)) * 100) / 100;
	}
	if (row.discount_type === "fixed_amount") {
		const v = Math.max(0, Number(row.discount_value) || 0);
		return Math.min(s, v);
	}
	return 0;
}

/** Busca cupón activo por código (insensible a mayúsculas), alineado con la RPC. */
export async function fetchActiveCouponByCode(
	supabase: SupabaseClient,
	companyId: string,
	rawCode: string,
	tableName = "discount_coupons",
): Promise<DiscountCouponRow | null> {
	const target = normalizeCouponCode(rawCode);
	if (!companyId || !target) return null;

	const { data, error } = await supabase
		.from(tableName)
		.select("*")
		.eq("company_id", companyId)
		.eq("is_active", true);

	if (error || !Array.isArray(data)) return null;

	const row = (data as DiscountCouponRow[]).find((r) => couponCodesMatch(r.code, target));
	return row ?? null;
}

function nowPastValidFrom(validFrom: string | null): boolean {
	if (validFrom == null || validFrom === "") return true;
	const t = Date.parse(validFrom);
	if (Number.isNaN(t)) return true;
	return Date.now() >= t;
}

function nowBeforeValidUntil(validUntil: string | null): boolean {
	if (validUntil == null || validUntil === "") return true;
	const t = Date.parse(validUntil);
	if (Number.isNaN(t)) return true;
	return Date.now() <= t;
}

export type CouponPreviewOk = {
	ok: true;
	discount: number;
	row: DiscountCouponRow;
};

export type CouponPreviewErr = {
	ok: false;
	key: string;
};

/**
 * Solo UX: replica validaciones típicas de la RPC antes de crear el pedido.
 * El servidor sigue siendo la fuente de verdad (race en cupos concurrentes).
 */
export async function buildCouponPreview(params: {
	supabase: SupabaseClient;
	companyId: string;
	rawCode: string;
	itemsSubtotal: number;
	clientPhone: string;
	tablesCoupons?: string;
	tablesClients?: string;
	tablesRedemptions?: string;
}): Promise<CouponPreviewOk | CouponPreviewErr> {
	const code = normalizeCouponCode(params.rawCode);
	if (!code || !params.companyId) return { ok: false, key: "empty" };

	const tCoupons = params.tablesCoupons ?? "discount_coupons";
	const tClients = params.tablesClients ?? "clients";
	const tRed = params.tablesRedemptions ?? "discount_coupon_redemptions";

	const row = await fetchActiveCouponByCode(params.supabase, params.companyId, code, tCoupons);
	if (!row) return { ok: false, key: "invalid_coupon" };

	if (!nowPastValidFrom(row.valid_from)) return { ok: false, key: "coupon_expired" };
	if (!nowBeforeValidUntil(row.valid_until)) return { ok: false, key: "coupon_expired" };

	const subtotal = Number(params.itemsSubtotal) || 0;
	if (subtotal + 1e-9 < Math.max(0, Number(row.min_order_subtotal ?? 0) || 0)) {
		return { ok: false, key: "coupon_min_subtotal" };
	}

	let existingClientId: string | null = null;
	const phone = String(params.clientPhone ?? "").trim();
	if (phone) {
		const { data: cl } = await params.supabase
			.from(tClients)
			.select("id")
			.eq("company_id", params.companyId)
			.eq("phone", phone)
			.maybeSingle();
		const id = (cl as { id?: string } | null)?.id;
		existingClientId = typeof id === "string" && id.trim() ? id.trim() : null;
	}

	if (row.scope === "client_only") {
		const rid = row.restricted_client_id;
		if (!rid || !existingClientId || existingClientId !== rid) {
			return { ok: false, key: "coupon_wrong_client" };
		}
	}

	if (row.max_redemptions != null && Number(row.redemptions_count ?? 0) >= Number(row.max_redemptions)) {
		return { ok: false, key: "coupon_usage_exhausted" };
	}

	const maxPer = Math.max(1, Number(row.max_redemptions_per_client ?? 1) || 1);
	if (phone) {
		const { count, error } = await params.supabase
			.from(tRed)
			.select("*", { count: "exact", head: true })
			.eq("coupon_id", row.id)
			.eq("client_phone", phone);

		if (!error && typeof count === "number" && count >= maxPer) {
			return { ok: false, key: "coupon_usage_exhausted_client" };
		}
	}

	const discount = computeCouponDiscountAmount(subtotal, row);
	if (discount <= 0) return { ok: false, key: "invalid_coupon" };

	return { ok: true, discount, row };
}
