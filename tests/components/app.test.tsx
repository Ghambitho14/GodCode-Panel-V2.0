import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { App } from "@/app";

vi.mock("@/modules/cash/admin/admin-app", () => ({
	AdminApp: () => <div data-testid="admin-app">AdminApp</div>,
}));

vi.mock("@/modules/cash/app-shell", () => ({
	AppShell: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="app-shell">{children}</div>
	),
}));

describe("App routes", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/");
	});

	it("renders login at /", () => {
		render(<App />);
		expect(screen.getByRole("heading", { name: "Acceso caja" })).toBeInTheDocument();
	});

	it("renders admin at /admin", async () => {
		window.history.pushState({}, "", "/admin");
		render(<App />);
		expect(await screen.findByTestId("admin-app")).toBeInTheDocument();
	});
});
