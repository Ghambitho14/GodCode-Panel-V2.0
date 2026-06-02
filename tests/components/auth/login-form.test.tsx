import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LoginForm } from "@/modules/auth/login-form";
import { renderWithRouter } from "../../setup/render-with-router";

vi.mock("@/integrations/supabase", () => ({
	bootstrapSession: vi.fn().mockResolvedValue(null),
	login: vi.fn(),
}));

import { bootstrapSession, login } from "@/integrations/supabase";

describe("LoginForm", () => {
	beforeEach(() => {
		vi.mocked(bootstrapSession).mockResolvedValue(null);
		vi.mocked(login).mockReset();
	});

	it("submits credentials", async () => {
		vi.mocked(login).mockResolvedValue(undefined);
		const user = userEvent.setup();
		renderWithRouter(<LoginForm />);

		await user.type(screen.getByPlaceholderText("admin@godcode.me"), "test@test.com");
		await user.type(screen.getByPlaceholderText("••••••••"), "secret123");
		await user.click(screen.getByRole("button", { name: /Ingresar/i }));

		await waitFor(() => {
			expect(login).toHaveBeenCalledWith("test@test.com", "secret123");
		});
	});

	it("shows error on login failure", async () => {
		vi.mocked(login).mockRejectedValue(new Error("Credenciales incorrectas."));
		const user = userEvent.setup();
		renderWithRouter(<LoginForm />);

		await user.type(screen.getByPlaceholderText("admin@godcode.me"), "bad@test.com");
		await user.type(screen.getByPlaceholderText("••••••••"), "wrong");
		await user.click(screen.getByRole("button", { name: /Ingresar/i }));

		expect(await screen.findByText("Credenciales incorrectas.")).toBeInTheDocument();
	});
});
