import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useManualOrderCart } from "@/modules/cash/hooks/manual-order/useManualOrderCart";

const product = (id, price, discount) => ({
	id,
	name: `Product ${id}`,
	price,
	has_discount: discount != null,
	discount_price: discount,
});

describe("useManualOrderCart", () => {
	it("addItem increases quantity for existing product", () => {
		const { result } = renderHook(() => useManualOrderCart());
		act(() => result.current.addItem(product("1", 1000)));
		act(() => result.current.addItem(product("1", 1000)));
		expect(result.current.items).toHaveLength(1);
		expect(result.current.items[0].quantity).toBe(2);
	});

	it("caps quantity at 20", () => {
		const { result } = renderHook(() =>
			useManualOrderCart([{ ...product("1", 1000), quantity: 20, note: "" }]),
		);
		act(() => result.current.addItem(product("1", 1000)));
		expect(result.current.items[0].quantity).toBe(20);
	});

	it("total uses discount price", () => {
		const { result } = renderHook(() => useManualOrderCart());
		act(() => result.current.addItem(product("1", 1000, 800)));
		expect(result.current.total).toBe(800);
	});

	it("removeItem removes product", () => {
		const { result } = renderHook(() => useManualOrderCart());
		act(() => result.current.addItem(product("1", 1000)));
		act(() => result.current.removeItem("1"));
		expect(result.current.items).toHaveLength(0);
	});
});
