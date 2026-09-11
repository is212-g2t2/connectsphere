import { test, expect } from "@playwright/test";

test.describe("Auth Lifecycle Loop", () => {
  test("completes signup, sign-out, login, and sign-out loop", async ({ page }) => {
    const uniqueId = Date.now();
    const testEmail = `e2e-user-${uniqueId}@example.com`;
    const testPassword = "Password123!";

    async function fillCredentials() {
      await page.locator("#email").fill(testEmail);
      await page.locator("#password").fill(testPassword);
    }

    // 1. Sign up
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible({
      timeout: 10_000,
    });

    // Only the sign-up form has name and confirm-password fields; fillCredentials is shared
    // with /login, which has neither.
    await page.locator("#name").fill("E2E User");
    await fillCredentials();
    await page.locator("#confirmPassword").fill(testPassword);
    await page.getByRole("button", { name: "Create account" }).click();

    // Verify signup confirmation heading
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Sign out so we can verify explicit login flow
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { timeout: 10_000 });

    // 3. Sign in via /login
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 10_000,
    });

    await fillCredentials();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // After sign-in, redirect completes to dashboard (PTR-6 AC1)
    await page.waitForURL("/dashboard", { timeout: 10_000 });

    // 4. Verify landing on /dashboard
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /welcome,/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(testEmail)).toBeVisible({
      timeout: 10_000,
    });

    // 5. Sign out and go back — no protected info may display (PTR-6 AC3)
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/", { timeout: 10_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /welcome,/i })).toHaveCount(0);
  });
});
