import { expect, test } from "@playwright/test";

const hasCredentials = Boolean(
	process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
);

test.describe("auth", () => {
	test.skip(!hasCredentials, "Set E2E_EMAIL and E2E_PASSWORD to run auth E2E");

	test("login redirects to admin", async ({ page }) => {
		await page.goto("/");
		await page.getByPlaceholder("admin@godcode.me").fill(process.env.E2E_EMAIL!);
		await page.getByPlaceholder("••••••••").fill(process.env.E2E_PASSWORD!);
		await page.getByRole("button", { name: /Ingresar/i }).click();
		await page.waitForURL("**/admin**", { timeout: 15_000 });
		expect(page.url()).toContain("/admin");
	});
});
