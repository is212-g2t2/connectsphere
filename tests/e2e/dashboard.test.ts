import { test, expect } from "@playwright/test";

test.describe("Protected routes (Signed Out)", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /welcome,/i })).toHaveCount(0);
  });

  test("redirects unauthenticated settings to login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /account/i })).toHaveCount(0);
  });
});
