import { describe, expect, it } from "vitest";
import {
	planRefundMovements,
	planSaleMovements,
	planSaleResyncMovements,
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

	describe("planSaleResyncMovements", () => {
		it("rebalances card to cash (order #1786 scenario)", () => {
			const planned = planSaleResyncMovements(
				{ total: 23000, payment_type: "tienda" },
				[{ type: "sale", amount: 23000, payment_method: "card" }],
			);
			expect(planned).toHaveLength(2);
			expect(planned).toEqual(
				expect.arrayContaining([
					{ type: "expense", amount: 23000, payment_method: "card" },
					{ type: "sale", amount: 23000, payment_method: "cash" },
				]),
			);
		});

		it("adds sale delta when total increases same method", () => {
			const planned = planSaleResyncMovements(
				{ total: 3500, payment_type: "tienda" },
				[{ type: "sale", amount: 3000, payment_method: "cash" }],
			);
			expect(planned).toEqual([
				{ type: "sale", amount: 500, payment_method: "cash" },
			]);
		});

		it("adds expense delta when total decreases same method", () => {
			const planned = planSaleResyncMovements(
				{ total: 2500, payment_type: "tienda" },
				[{ type: "sale", amount: 3000, payment_method: "cash" }],
			);
			expect(planned).toEqual([
				{ type: "expense", amount: 500, payment_method: "cash" },
			]);
		});

		it("rebalances mixed to single cash", () => {
			const planned = planSaleResyncMovements(
				{ total: 3000, payment_type: "tienda" },
				[
					{ type: "sale", amount: 2000, payment_method: "cash" },
					{ type: "sale", amount: 1000, payment_method: "card" },
				],
			);
			expect(planned).toEqual([
				{ type: "sale", amount: 1000, payment_method: "cash" },
				{ type: "expense", amount: 1000, payment_method: "card" },
			]);
		});

		it("returns empty when already in sync", () => {
			const planned = planSaleResyncMovements(
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

		it("delegates to planSaleMovements when no prior movements", () => {
			const planned = planSaleResyncMovements(
				{ total: 3000, payment_type: "tienda" },
				[],
			);
			expect(planned).toEqual([
				{ type: "sale", amount: 3000, payment_method: "cash" },
			]);
		});
	});
});
