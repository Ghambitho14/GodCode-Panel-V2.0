import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useManualOrderForm } from "@/modules/cash/hooks/manual-order/useManualOrderForm";

describe("useManualOrderForm", () => {
	it("updateOrderType to pickup clears delivery fields", () => {
		const { result } = renderHook(() => useManualOrderForm());
		act(() => result.current.updateOrderType("delivery"));
		act(() => result.current.updateDeliveryAddress("Calle 1"));
		act(() => result.current.updateDeliveryFee(1500));
		act(() => result.current.updateOrderType("pickup"));
		expect(result.current.form.delivery_address).toBe("");
		expect(result.current.form.delivery_fee).toBe(0);
	});

	it("handleRutChange validates RUT", () => {
		const { result } = renderHook(() => useManualOrderForm());
		act(() =>
			result.current.handleRutChange({
				target: { value: "11.111.111-2" },
			}),
		);
		expect(result.current.rutValid).toBe(false);
	});

	it("resetForm restores defaults", () => {
		const { result } = renderHook(() => useManualOrderForm());
		act(() => result.current.updateClientName("Test"));
		act(() => result.current.resetForm());
		expect(result.current.form.client_name).toBe("CAJA");
	});

	it("updatePaymentMode toggles mixed payment fields", () => {
		const { result } = renderHook(() => useManualOrderForm());
		act(() => result.current.updatePaymentMode("mixed"));
		expect(result.current.form.payment_mode).toBe("mixed");
		act(() => result.current.updateCashAmount(2000));
		act(() => result.current.updateCardAmount(1000));
		expect(result.current.form.cash_amount).toBe(2000);
		expect(result.current.form.card_amount).toBe(1000);
		act(() => result.current.updatePaymentType("tarjeta"));
		expect(result.current.form.payment_mode).toBe("single");
		expect(result.current.form.cash_amount).toBe(0);
	});

	it("updateCashTendered stores tender amount", () => {
		const { result } = renderHook(() => useManualOrderForm());
		act(() => result.current.updateCashTendered("10000"));
		expect(result.current.form.cash_tendered).toBe(10000);
	});
});
