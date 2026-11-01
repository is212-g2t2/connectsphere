import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";

test.describe("Protected routes (Signed Out)", () => {
  test("redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Your events" })).toHaveCount(0);
  });

  test("redirects unauthenticated settings to login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /account/i })).toHaveCount(0);
  });

  test("redirects an unauthenticated event page to login", async ({ page }) => {
    await page.goto("/events/1");
    await expect(page).toHaveURL(/\/login/);
  });
});

/** Check the settings response after a real sign-up. Unit tests cover dashboard role checks, so
 * this test covers the server render that needs a real session.
 */
test.describe("Settings after sign-up", () => {
  const password = "Password123!";

  async function signUpAs(page: Page) {
    const email = `e2e-attendee-${Date.now()}@example.com`;

    await page.goto("/signup");
    await waitForHydration(page);
    await page.locator("#name").fill("E2E Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.locator("#role-attendee").check();

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    // Sign-up creates a session, so the user can open the dashboard without signing in again.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible({
      timeout: 10_000,
    });
  }

  /** PTR-66: the route loader includes linked providers in the server HTML. A client-side fetch
   * would leave "Loading…" until hydration.
   */
  test("renders linked providers in the settings server response", async ({ page }) => {
    await signUpAs(page);

    const response = await page.request.get("/settings");
    const html = await response.text();

    expect(html).toContain("Password");
    expect(html).not.toContain("Loading…");
  });
});
