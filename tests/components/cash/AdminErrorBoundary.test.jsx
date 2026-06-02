import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AdminErrorBoundary from "@/modules/cash/components/AdminErrorBoundary";

function Boom() {
	throw new Error("Test error");
}

describe("AdminErrorBoundary", () => {
	it("renders fallback on error and retries", async () => {
		const onRetry = vi.fn();
		const user = userEvent.setup();
		const { rerender } = render(
			<AdminErrorBoundary onRetry={onRetry} tabLabel="Inventario">
				<Boom />
			</AdminErrorBoundary>,
		);

		expect(screen.getByText(/Algo salió mal en «Inventario»/)).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /Reintentar/i }));
		expect(onRetry).toHaveBeenCalled();

		rerender(
			<AdminErrorBoundary onRetry={onRetry}>
				<div>Recovered</div>
			</AdminErrorBoundary>,
		);
	});
});
