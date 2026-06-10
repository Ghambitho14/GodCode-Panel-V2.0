import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchClientAddressesMock = vi.fn();

vi.mock("@/modules/cash/services/clientService", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fetchClientAddresses: (...args) => fetchClientAddressesMock(...args),
	};
});

import { useManualOrderForm } from "@/modules/cash/hooks/manual-order/useManualOrderForm";

describe("useManualOrderForm", () => {
	beforeEach(() => {
		fetchClientAddressesMock.mockReset();
	});

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

	it("applyClientRecord autofills delivery address when order is delivery", async () => {
		fetchClientAddressesMock.mockResolvedValue([
			{
				id: "addr-1",
				address_line: "Calle Falsa 123",
				reference: "Casa azul",
				named_area_id: "zone-1",
				delivery_km: 2,
			},
		]);

		const { result } = renderHook(() => useManualOrderForm());
		act(() => result.current.updateOrderType("delivery"));

		await act(async () => {
			await result.current.applyClientRecord(
				{
					id: "client-1",
					name: "Juan Pérez",
					phone: "+56912345678",
					rut: "11.111.111-1",
				},
				{ subtotal: 10000 },
			);
		});

		expect(result.current.form.selected_client_id).toBe("client-1");
		expect(result.current.form.delivery_address).toBe("Calle Falsa 123");
		expect(result.current.form.delivery_reference).toBe("Casa azul");
		expect(result.current.form.delivery_named_area_id).toBe("zone-1");
		expect(result.current.form.selected_address_id).toBe("addr-1");
	});

	it("updateClientName clears selected client linkage", async () => {
		fetchClientAddressesMock.mockResolvedValue([]);
		const { result } = renderHook(() => useManualOrderForm());

		await act(async () => {
			await result.current.applyClientRecord({ id: "c1", name: "Ana", phone: "+56911111111" });
		});
		act(() => result.current.updateClientName("Ana nueva"));
		expect(result.current.form.selected_client_id).toBe("");
	});
});
