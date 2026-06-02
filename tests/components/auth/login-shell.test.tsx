import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginShell } from "@/modules/auth/login-shell";

vi.mock("@/modules/auth/login-form", () => ({
	LoginForm: () => <div data-testid="login-form">LoginForm</div>,
}));

describe("LoginShell", () => {
	it("shows caja mode by default", () => {
		render(<LoginShell displayName="GodCode Caja" />);
		expect(screen.getByRole("heading", { name: "Acceso caja" })).toBeInTheDocument();
		expect(screen.getByTestId("login-form")).toBeInTheDocument();
	});

	it("switches to admin mode", async () => {
		const user = userEvent.setup();
		render(<LoginShell displayName="GodCode Caja" />);
		await user.click(screen.getAllByRole("button", { name: "Acceso admin" })[0]!);
		expect(screen.getByRole("heading", { name: "Acceso admin" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Acceso GodCode/i })).toBeInTheDocument();
	});
});
