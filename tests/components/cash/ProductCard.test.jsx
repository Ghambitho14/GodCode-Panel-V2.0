import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProductCard from "@/modules/cash/components/manual-order/ProductCard";

const product = {
	id: "p1",
	name: "Pizza",
	price: 5000,
	has_discount: false,
	description: "Deliciosa",
};

describe("ProductCard", () => {
	it("calls addItem when plus clicked", async () => {
		const user = userEvent.setup();
		const addItem = vi.fn();
		render(
			<ProductCard
				product={product}
				quantity={0}
				addItem={addItem}
				updateQuantity={vi.fn()}
				removeItem={vi.fn()}
				showProductImages={false}
			/>,
		);

		const addButtons = screen.getAllByRole("button");
		const plus = addButtons.find((b) => b.querySelector("svg"));
		if (plus) await user.click(plus);
		expect(addItem).toHaveBeenCalledWith(product);
	});

	it("shows discount badge when product has discount", () => {
		render(
			<ProductCard
				product={{ ...product, has_discount: true, discount_price: 4000 }}
				quantity={1}
				addItem={vi.fn()}
				updateQuantity={vi.fn()}
				removeItem={vi.fn()}
				showProductImages={false}
			/>,
		);
		expect(screen.getByText("Oferta")).toBeInTheDocument();
	});
});
