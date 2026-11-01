import { test, expect } from "@playwright/test";

import { E2E_BASE_URL } from "./base-url";
import { waitForHydration } from "./hydration";

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
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible({
      timeout: 10_000,
    });

    // Only the sign-up form has name and confirm-password fields. `fillCredentials` also serves
    // `/login`, which has neither field.
    await page.locator("#name").fill("E2E User");
    await fillCredentials();
    await page.locator("#confirmPassword").fill(testPassword);
    await page.locator("#role-attendee").check();
    await page.getByRole("button", { name: "Create account" }).click();

    // Verify signup confirmation heading
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Sign out before testing login.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/", { timeout: 10_000 });

    // 3. Sign in via /login
    await page.goto("/login");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 10_000,
    });

    await fillCredentials();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // PTR-6 AC1: sign-in redirects to the dashboard.
    await page.waitForURL("/dashboard", { timeout: 10_000 });

    // 4. Check that the page opens on `/dashboard`.
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible({
      timeout: 10_000,
    });

    // 5. Sign out and go back. PTR-6 AC3: do not show protected information.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/", { timeout: 10_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /welcome,/i })).toHaveCount(0);
  });

  test("rejects a wrong password with an inline error and stays on the form", async ({ page }) => {
    const email = `e2e-wrong-password-${Date.now()}@example.com`;
    const response = await page.request.post("/api/auth/sign-up/email", {
      headers: { Origin: E2E_BASE_URL },
      data: { name: "Wrong Password", email, password: "Password123!" },
    });
    expect(response.ok(), await response.text()).toBe(true);

    // Sign-up creates a session, and `/login` redirects signed-in users. Clear the session first.
    const signOut = await page.request.post("/api/auth/sign-out", {
      headers: { Origin: E2E_BASE_URL },
    });
    expect(signOut.ok(), await signOut.text()).toBe(true);

    await page.goto("/login");
    await waitForHydration(page);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("DefinitelyWrong456!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  /** PTR-73: `/login` and `/signup` read the user from route context. The sign-up guard runs only
   * on arrival. The post-sign-up panel refreshes that context in place and must stay open, but
   * these arrival requests must redirect signed-in users.
   */
  test("sends a signed-in visitor away from the sign-in and sign-up forms", async ({ page }) => {
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: {
        name: "Returning visitor",
        email: `e2e-returning-${Date.now()}@example.com`,
        password: "Password123!",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);

    await page.goto("/login");
    await expect(page).toHaveURL("/dashboard", { timeout: 10_000 });

    await page.goto("/signup");
    await expect(page).toHaveURL("/dashboard", { timeout: 10_000 });
  });
});
