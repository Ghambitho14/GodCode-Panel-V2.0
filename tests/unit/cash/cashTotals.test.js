import { describe, expect, it } from "vitest";
import {
	EXPENSE_KIND_CASH_WITHDRAWAL,
	EXPENSE_KIND_OPERATING,
} from "@/modules/cash/utils/cashMovementKinds";
import { computeShiftTotals } from "@/modules/cash/utils/cashTotals";

describe("computeShiftTotals", () => {
	it("sums cash from order sales", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 10000, payment_method: "cash" },
		]);
		expect(totals.cash).toBe(10000);
		expect(totals.card).toBe(0);
		expect(totals.online).toBe(0);
		expect(totals.income).toBe(10000);
	});

	it("does not subtract cash withdrawals from method totals", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 10000, payment_method: "cash" },
			{
				type: "expense",
				amount: 2500,
				payment_method: "cash",
				expense_kind: EXPENSE_KIND_CASH_WITHDRAWAL,
			},
		]);
		expect(totals.cash).toBe(10000);
		expect(totals.cashWithdrawals).toBe(2500);
		expect(totals.expenses).toBe(2500);
	});

	it("subtracts order refunds from the correct payment method", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 8000, payment_method: "card" },
			{
				type: "expense",
				amount: 3000,
				payment_method: "card",
				order_id: "ord-1",
			},
		]);
		expect(totals.card).toBe(5000);
		expect(totals.refundExpenses).toBe(3000);
		expect(totals.income).toBe(5000);
	});

	it("does not subtract operating expenses from card totals", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 12000, payment_method: "card" },
			{
				type: "expense",
				amount: 4000,
				payment_method: "card",
				expense_kind: EXPENSE_KIND_OPERATING,
			},
		]);
		expect(totals.card).toBe(12000);
		expect(totals.operatingExpenses).toBe(4000);
	});

	it("includes manual income in income but not in method chips", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 5000, payment_method: "cash" },
			{ type: "income", amount: 2000, payment_method: "cash" },
		]);
		expect(totals.cash).toBe(5000);
		expect(totals.income).toBe(7000);
	});

	it("ignores synthetic cancel rows", () => {
		const totals = computeShiftTotals([
			{ type: "sale", amount: 6000, payment_method: "online" },
			{ type: "cancel", amount: 0, payment_method: null },
		]);
		expect(totals.online).toBe(6000);
	});
});
