import { expect, test } from "@playwright/test";

test.describe("routing", () => {
	test("home shows login shell with caja access", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Acceso caja" })).toBeVisible();
		await expect(page.getByPlaceholder("admin@godcode.me")).toBeVisible();
	});

	test("/admin route loads without crash", async ({ page }) => {
		await page.goto("/admin");
		await expect(page.locator("body")).toBeVisible();
	});
});
