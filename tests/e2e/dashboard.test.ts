import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";

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

/**
 * The settings server response, reached through a real sign-up. Dashboard role-gating is covered
 * far more cheaply by the unit-tested view and the route guards; this block keeps the one
 * assertion that needs a real session against a real server render.
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

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    // Sign-up signs the user straight in, so the dashboard is reachable without a sign-in step.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /welcome,/i })).toBeVisible({ timeout: 10_000 });
  }

  /**
   * PTR-66: linked providers come from the route loader, so they are in the server HTML. A
   * client-side fetch would leave "Loading…" in the response and only resolve after hydration.
   */
  test("renders linked providers in the settings server response", async ({ page }) => {
    await signUpAs(page);

    const response = await page.request.get("/settings");
    const html = await response.text();

    expect(html).toContain("Password");
    expect(html).not.toContain("Loading…");
  });
});
