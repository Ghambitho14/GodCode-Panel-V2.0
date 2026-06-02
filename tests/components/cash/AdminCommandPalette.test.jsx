import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminCommandPalette } from "@/modules/cash/components/AdminCommandPalette";

const items = [
	{ id: "inventory", label: "Inventario", group: "Operación" },
	{ id: "orders", label: "Pedidos", group: "Operación" },
];

describe("AdminCommandPalette", () => {
	it("filters items by search query", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(
			<AdminCommandPalette
				open
				onClose={() => {}}
				items={items}
				onSelect={onSelect}
			/>,
		);

		await user.type(screen.getByPlaceholderText("Buscar sección…"), "invent");
		expect(screen.getByText("Inventario")).toBeInTheDocument();
		expect(screen.queryByText("Pedidos")).not.toBeInTheDocument();
	});

	it("calls onSelect when item clicked", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(
			<AdminCommandPalette
				open
				onClose={() => {}}
				items={items}
				onSelect={onSelect}
			/>,
		);

		await user.click(screen.getByText("Pedidos"));
		expect(onSelect).toHaveBeenCalledWith("orders");
	});

	it("returns null when closed", () => {
		const { container } = render(
			<AdminCommandPalette
				open={false}
				onClose={() => {}}
				items={items}
				onSelect={() => {}}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
