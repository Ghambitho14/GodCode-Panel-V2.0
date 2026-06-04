import { describe, expect, it } from "vitest";
import {
	planRefundMovements,
	planSaleMovements,
} from "@/modules/cash/utils/orderPaymentMovements";

describe("orderPaymentMovements", () => {
	it("planSaleMovements creates one sale for single-method order", () => {
		const planned = planSaleMovements(
			{ total: 3000, payment_type: "tienda" },
			[],
		);
		expect(planned).toEqual([
			{ type: "sale", amount: 3000, payment_method: "cash" },
		]);
	});

	it("planSaleMovements creates two sales for mixed breakdown", () => {
		const planned = planSaleMovements(
			{
				total: 3000,
				payment_type: "tienda",
				payment_breakdown: { cash: 2000, card: 1000, online: 0 },
			},
			[],
		);
		expect(planned).toEqual([
			{ type: "sale", amount: 2000, payment_method: "cash" },
			{ type: "sale", amount: 1000, payment_method: "card" },
		]);
	});

	it("planSaleMovements skips already registered movements", () => {
		const planned = planSaleMovements(
			{
				total: 3000,
				payment_type: "tienda",
				payment_breakdown: { cash: 2000, card: 1000, online: 0 },
			},
			[
				{ type: "sale", amount: 2000, payment_method: "cash" },
				{ type: "sale", amount: 1000, payment_method: "card" },
			],
		);
		expect(planned).toEqual([]);
	});

	it("planRefundMovements refunds each sale method", () => {
		const planned = planRefundMovements(
			{ total: 3000, payment_type: "tienda" },
			[
				{ type: "sale", amount: 2000, payment_method: "cash" },
				{ type: "sale", amount: 1000, payment_method: "card" },
			],
		);
		expect(planned).toEqual([
			{ type: "expense", amount: 2000, payment_method: "cash" },
			{ type: "expense", amount: 1000, payment_method: "card" },
		]);
	});

	it("planRefundMovements returns empty when already refunded", () => {
		const planned = planRefundMovements(
			{ total: 3000, payment_type: "tienda" },
			[
				{ type: "sale", amount: 2000, payment_method: "cash" },
				{ type: "sale", amount: 1000, payment_method: "card" },
				{ type: "expense", amount: 2000, payment_method: "cash" },
				{ type: "expense", amount: 1000, payment_method: "card" },
			],
		);
		expect(planned).toEqual([]);
	});
});
