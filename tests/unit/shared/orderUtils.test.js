import { describe, expect, it } from "vitest";
import {
	flattenDeliveryAddress,
	getOrderCouponDiscountMeta,
	getPaymentSlug,
	isMenuOrder,
	isOnlineOrder,
	isPanelManualOrder,
	resolveOrderCouponCode,
	sanitizeOrder,
} from "@/shared/utils/orderUtils";

describe("orderUtils", () => {
	it("isOnlineOrder detects online payment type", () => {
		expect(isOnlineOrder({ payment_type: "online" })).toBe(true);
		expect(isOnlineOrder({ payment_type: "tienda" })).toBe(false);
	});

	it("isMenuOrder and isPanelManualOrder", () => {
		expect(isMenuOrder({ payment_method_specific: "stripe" })).toBe(true);
		expect(isPanelManualOrder({ payment_method_specific: "" })).toBe(true);
	});

	it("getPaymentSlug maps methods", () => {
		expect(getPaymentSlug({ payment_method_specific: "efectivo" })).toBe(
			"cash",
		);
		expect(getPaymentSlug({ payment_method_specific: "tarjeta" })).toBe("card");
	});

	it("flattenDeliveryAddress from object", () => {
		expect(
			flattenDeliveryAddress({
				address: "Av 1",
				reference: "Depto 2",
				named_area_id: "z1",
			}),
		).toEqual({
			delivery_address: "Av 1",
			delivery_reference: "Depto 2",
			delivery_named_area_id: "z1",
		});
	});

	it("sanitizeOrder parses string items JSON", () => {
		const order = sanitizeOrder({
			items: '[{"name":"Pizza","price":1000,"quantity":1}]',
			total: "5000",
			delivery_address: '{"address":"Calle 1"}',
		});
		expect(order.items).toHaveLength(1);
		expect(order.total).toBe(5000);
		expect(order.delivery_address).toMatchObject({ address: "Calle 1" });
	});

	it("sanitizeOrder returns null for falsy input", () => {
		expect(sanitizeOrder(null)).toBeNull();
	});

	it("sanitizeOrder maps coupon_code from discount_coupons join", () => {
		const order = sanitizeOrder({
			id: 1,
			total: 9000,
			discount_coupon_id: "coupon-uuid",
			discount_total: 1000,
			discount_coupons: { code: "SAVE10" },
			items: [],
		});
		expect(order.coupon_code).toBe("SAVE10");
		expect(order.discount_coupon_id).toBe("coupon-uuid");
		expect(order.discount_total).toBe(1000);
	});

	it("resolveOrderCouponCode prefers join over legacy field", () => {
		expect(
			resolveOrderCouponCode({
				coupon_code: "OLD",
				discount_coupons: { code: "NEW" },
			}),
		).toBe("NEW");
	});

	it("getOrderCouponDiscountMeta returns null without discount", () => {
		expect(getOrderCouponDiscountMeta({ total: 5000, discount_total: 0 })).toBeNull();
	});

	it("getOrderCouponDiscountMeta computes from discount_total", () => {
		const meta = getOrderCouponDiscountMeta({
			total: 9000,
			discount_total: 1000,
		});
		expect(meta).toEqual({
			originalTotal: 10000,
			discountTotal: 1000,
			discountPercent: 10,
		});
	});

	it("getOrderCouponDiscountMeta falls back with discount_coupon_id and subtotal", () => {
		const meta = getOrderCouponDiscountMeta({
			total: 7794,
			discount_total: 0,
			discount_coupon_id: "uuid-1",
			subtotal: 8660,
		});
		expect(meta).toEqual({
			originalTotal: 8660,
			discountTotal: 866,
			discountPercent: 10,
		});
	});
});
