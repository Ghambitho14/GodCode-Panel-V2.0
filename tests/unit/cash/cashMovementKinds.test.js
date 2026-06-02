import { describe, expect, it } from "vitest";
import {
	EXPENSE_KIND_CASH_WITHDRAWAL,
	EXPENSE_KIND_OPERATING,
	isCashWithdrawal,
	isManualLocalExpense,
	isOperatingLocalExpense,
	isOrderLinkedExpense,
	labelForManualExpenseKind,
} from "@/modules/cash/utils/cashMovementKinds";

describe("cashMovementKinds", () => {
	it("isManualLocalExpense detects expense without order", () => {
		expect(isManualLocalExpense({ type: "expense" })).toBe(true);
		expect(isManualLocalExpense({ type: "expense", order_id: "" })).toBe(true);
		expect(isManualLocalExpense({ type: "expense", order_id: "ord-1" })).toBe(
			false,
		);
	});

	it("isCashWithdrawal and isOperatingLocalExpense", () => {
		const withdrawal = {
			type: "expense",
			expense_kind: EXPENSE_KIND_CASH_WITHDRAWAL,
		};
		const operating = { type: "expense", expense_kind: EXPENSE_KIND_OPERATING };
		const legacy = { type: "expense" };

		expect(isCashWithdrawal(withdrawal)).toBe(true);
		expect(isOperatingLocalExpense(operating)).toBe(true);
		expect(isOperatingLocalExpense(legacy)).toBe(true);
	});

	it("isOrderLinkedExpense for order expenses", () => {
		expect(isOrderLinkedExpense({ type: "expense", order_id: "x" })).toBe(
			true,
		);
	});

	it("labelForManualExpenseKind", () => {
		expect(
			labelForManualExpenseKind({
				type: "expense",
				expense_kind: EXPENSE_KIND_CASH_WITHDRAWAL,
			}),
		).toBe("Retiro caja");
	});
});
