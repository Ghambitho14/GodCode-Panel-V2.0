import { describe, expect, it } from "vitest";
import {
	flattenDeliveryAddress,
	getPaymentSlug,
	isMenuOrder,
	isOnlineOrder,
	isPanelManualOrder,
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
});
