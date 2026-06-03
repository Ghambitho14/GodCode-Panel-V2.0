import { describe, expect, it, vi } from "vitest";
import {
	buildCouponPreview,
	computeCouponDiscountAmount,
	couponCodesMatch,
	normalizeCouponCode,
} from "@/lib/discount-coupon";
import { makeCouponRow } from "../../setup/fixtures/coupons";

function makeSupabaseMock(opts: {
	couponRow: ReturnType<typeof makeCouponRow>;
	redemptionCount: number;
	excludeOrderIdUsed?: boolean;
}) {
	const neq = vi.fn().mockReturnThis();
	const redemptionChain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq,
		then: undefined as unknown,
	};
	// head: true count query resolves via final await on chain
	Object.assign(redemptionChain, {
		then(onFulfilled: (v: { count: number; error: null }) => unknown) {
			if (opts.excludeOrderIdUsed !== undefined) {
				expect(neq).toHaveBeenCalledWith("order_id", 42);
			}
			return Promise.resolve({ count: opts.redemptionCount, error: null }).then(onFulfilled);
		},
	});

	const from = vi.fn((table: string) => {
		if (table === "discount_coupons") {
			return {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockResolvedValue({ data: [opts.couponRow], error: null }),
				}),
			};
		}
		if (table === "clients") {
			return {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
		}
		if (table === "discount_coupon_redemptions") {
			return redemptionChain;
		}
		throw new Error(`unexpected table ${table}`);
	});

	return { from, neq };
}

describe("discount-coupon", () => {
	it("normalizeCouponCode trims and handles null", () => {
		expect(normalizeCouponCode("  abc  ")).toBe("abc");
		expect(normalizeCouponCode(null)).toBe("");
	});

	it("couponCodesMatch is case-insensitive", () => {
		expect(couponCodesMatch("save10", "SAVE10")).toBe(true);
		expect(couponCodesMatch("a", "b")).toBe(false);
	});

	it("computeCouponDiscountAmount percent caps at 100%", () => {
		const row = makeCouponRow({ discount_type: "percent", discount_value: 50 });
		expect(computeCouponDiscountAmount(10000, row)).toBe(5000);
	});

	it("computeCouponDiscountAmount fixed_amount caps at subtotal", () => {
		const row = makeCouponRow({
			discount_type: "fixed_amount",
			discount_value: 5000,
		});
		expect(computeCouponDiscountAmount(3000, row)).toBe(3000);
		expect(computeCouponDiscountAmount(10000, row)).toBe(5000);
	});

	it("computeCouponDiscountAmount returns 0 for unknown type", () => {
		const row = makeCouponRow({ discount_type: "other" });
		expect(computeCouponDiscountAmount(1000, row)).toBe(0);
	});

	it("buildCouponPreview excludeOrderId permite revalidar cupón del pedido en edición", async () => {
		const couponRow = makeCouponRow({
			max_redemptions_per_client: 1,
		});
		const { from, neq } = makeSupabaseMock({
			couponRow,
			redemptionCount: 0,
			excludeOrderIdUsed: true,
		});
		const supabase = { from } as unknown as import("@supabase/supabase-js").SupabaseClient;

		const result = await buildCouponPreview({
			supabase,
			companyId: "company-1",
			rawCode: "SAVE10",
			itemsSubtotal: 10000,
			clientPhone: "+56 9 1234 5678",
			excludeOrderId: 42,
		});

		expect(neq).toHaveBeenCalledWith("order_id", 42);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.discount).toBe(1000);
		}
	});

	it("buildCouponPreview sin excludeOrderId rechaza cupón ya canjeado por el cliente", async () => {
		const couponRow = makeCouponRow({
			max_redemptions_per_client: 1,
		});
		const { from } = makeSupabaseMock({
			couponRow,
			redemptionCount: 1,
		});
		const supabase = { from } as unknown as import("@supabase/supabase-js").SupabaseClient;

		const result = await buildCouponPreview({
			supabase,
			companyId: "company-1",
			rawCode: "SAVE10",
			itemsSubtotal: 10000,
			clientPhone: "+56 9 1234 5678",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.key).toBe("coupon_usage_exhausted_client");
		}
	});
});
