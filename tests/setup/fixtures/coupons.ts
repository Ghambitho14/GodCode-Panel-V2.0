import type { DiscountCouponRow } from "@/lib/discount-coupon";

export function makeCouponRow(
	overrides: Partial<DiscountCouponRow> = {},
): DiscountCouponRow {
	return {
		id: "coupon-1",
		company_id: "company-1",
		code: "SAVE10",
		discount_type: "percent",
		discount_value: 10,
		scope: "global",
		restricted_client_id: null,
		min_order_subtotal: null,
		max_redemptions: null,
		redemptions_count: null,
		max_redemptions_per_client: null,
		valid_from: null,
		valid_until: null,
		is_active: true,
		...overrides,
	};
}
