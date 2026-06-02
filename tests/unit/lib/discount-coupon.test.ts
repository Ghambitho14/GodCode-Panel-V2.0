import { describe, expect, it } from "vitest";
import {
	computeCouponDiscountAmount,
	couponCodesMatch,
	normalizeCouponCode,
} from "@/lib/discount-coupon";
import { makeCouponRow } from "../../setup/fixtures/coupons";

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
});
