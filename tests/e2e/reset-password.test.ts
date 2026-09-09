import { test, expect } from "@playwright/test";

test.describe("Reset password", () => {
  test("plain visit asks for an email address", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("emailed link with a token asks for a new password", async ({ page }) => {
    await page.goto("/reset-password?token=smoke-test-token");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByLabel(/new password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /save password/i })).toBeVisible();
  });

  test("stale link explains itself and offers a new one", async ({ page }) => {
    await page.goto("/reset-password?error=INVALID_TOKEN");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("login page links here", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /forgot your password/i }).click();
    await expect(page).toHaveURL(/\/reset-password/);
  });
});
