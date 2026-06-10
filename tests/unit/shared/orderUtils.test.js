import { describe, expect, it } from "vitest";
import {
	flattenDeliveryAddress,
	getOrderCouponDiscountMeta,
	getPaymentLabel,
	getPaymentSlug,
	getOrderPaymentBreakdown,
	buildPaymentBreakdownForOrder,
	validateCheckoutPayment,
	computeChangeDue,
	isMixedPaymentBreakdown,
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
		expect(getPaymentSlug({ payment_method_specific: "stripe" })).toBe("card");
		expect(getPaymentSlug({ payment_method_specific: "mercadopago" })).toBe("card");
		expect(getPaymentSlug({ payment_method_specific: "transferencia_bancaria" })).toBe(
			"transfer",
		);
		expect(getPaymentSlug({ payment_type: "online", payment_method_specific: "stripe" })).toBe(
			"card",
		);
		expect(getPaymentSlug({ payment_type: "online" })).toBe("transfer");
	});

	it("isOnlineOrder excludes card processors from menu", () => {
		expect(isOnlineOrder({ payment_method_specific: "stripe" })).toBe(false);
		expect(isOnlineOrder({ payment_method_specific: "transferencia_bancaria" })).toBe(true);
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

	it("getOrderPaymentBreakdown uses stored mixed breakdown", () => {
		expect(
			getOrderPaymentBreakdown({
				total: 3000,
				payment_type: "tienda",
				payment_breakdown: { cash: 2000, card: 1000, online: 0 },
			}),
		).toEqual({ cash: 2000, card: 1000, online: 0 });
	});

	it("getOrderPaymentBreakdown falls back to payment_type", () => {
		expect(
			getOrderPaymentBreakdown({ total: 3000, payment_type: "tarjeta" }),
		).toEqual({ cash: 0, card: 3000, online: 0 });
	});

	it("getPaymentLabel shows mixed breakdown", () => {
		expect(
			getPaymentLabel({
				payment_breakdown: { cash: 2000, card: 1000, online: 0 },
			}),
		).toBe("Mixto (Ef. $2.000 + Tarjeta $1.000)");
	});

	it("buildPaymentBreakdownForOrder returns null for single method", () => {
		expect(
			buildPaymentBreakdownForOrder({
				payment_mode: "single",
				payment_type: "tienda",
				total: 3000,
			}),
		).toBeNull();
	});

	it("validateCheckoutPayment requires tender for cash", () => {
		expect(
			validateCheckoutPayment({
				payment_mode: "single",
				payment_type: "tienda",
				cash_tendered: 10000,
				totalToPay: 3000,
			}).valid,
		).toBe(true);
		expect(
			validateCheckoutPayment({
				payment_mode: "single",
				payment_type: "tienda",
				cash_tendered: 2000,
				totalToPay: 3000,
			}).valid,
		).toBe(false);
	});

	it("validateCheckoutPayment validates mixed split", () => {
		expect(
			validateCheckoutPayment({
				payment_mode: "mixed",
				cash_amount: 2000,
				card_amount: 1000,
				cash_tendered: 5000,
				totalToPay: 3000,
			}).valid,
		).toBe(true);
		expect(
			validateCheckoutPayment({
				payment_mode: "mixed",
				cash_amount: 1500,
				card_amount: 1000,
				totalToPay: 3000,
			}).valid,
		).toBe(false);
	});

	it("computeChangeDue subtracts cash due", () => {
		expect(computeChangeDue(10000, 3000)).toBe(7000);
	});

	it("isMixedPaymentBreakdown detects multiple methods", () => {
		expect(isMixedPaymentBreakdown({ cash: 2000, card: 1000, online: 0 })).toBe(true);
		expect(isMixedPaymentBreakdown({ cash: 3000, card: 0, online: 0 })).toBe(false);
	});
});
