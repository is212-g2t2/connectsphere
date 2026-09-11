import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
 * PTR-7 criterion 2, first half: "the function is not displayed".
 *
 * The refusal half is covered server-side, but nothing else in the suite renders the dashboard —
 * delete the `can(...)` wrapper in `src/routes/dashboard.tsx` and type:check, the unit suite and
 * the integration suite all stay green while every attendee sees the upload card again.
 */
test.describe("Role-gated interface", () => {
  const password = "Password123!";

  async function signUpAs(page: Page, role: "Attendee" | "Event Organiser") {
    const email = `e2e-${role.replace(/\s/g, "-").toLowerCase()}-${Date.now()}@example.com`;

    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await page.locator("#name").fill(`E2E ${role}`);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);

    // Attendee is the default, so only the organiser run has to touch the Select.
    if (role === "Event Organiser") {
      await page.locator("#role").click();
      await page.getByRole("option", { name: role }).click();
    }

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    // Sign-up signs the user straight in, so the dashboard is reachable without a sign-in step.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /welcome,/i })).toBeVisible({ timeout: 10_000 });
  }

  test("hides the upload control from an attendee", async ({ page }) => {
    await signUpAs(page, "Attendee");

    await expect(page.getByRole("heading", { name: "File upload" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose file" })).toHaveCount(0);

    // The session summary every role sees stays, so this proves a gated function is missing
    // rather than the whole page.
    await expect(page.locator("dt", { hasText: "Role" })).toBeVisible();
  });

  test("shows the upload control to an event organiser", async ({ page }) => {
    await signUpAs(page, "Event Organiser");

    await expect(page.getByRole("heading", { name: "File upload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
  });
});
