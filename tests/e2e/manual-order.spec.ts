import { expect, test } from "@playwright/test";

const hasCredentials = Boolean(
	process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
);

test.describe("manual order", () => {
	test.skip(
		!hasCredentials,
		"Set E2E_EMAIL and E2E_PASSWORD plus seeded branch data to run",
	);

	test("admin panel loads after login", async ({ page }) => {
		await page.goto("/");
		await page.getByPlaceholder("admin@godcode.me").fill(process.env.E2E_EMAIL!);
		await page.getByPlaceholder("••••••••").fill(process.env.E2E_PASSWORD!);
		await page.getByRole("button", { name: /Ingresar/i }).click();
		await page.waitForURL("**/admin**", { timeout: 15_000 });
		await expect(page.locator("body")).toBeVisible();
	});
});
