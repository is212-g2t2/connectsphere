import { test, expect } from "@playwright/test";

/**
 * PTR-8: `GET /api/events` is a `server.handlers` route reached directly by the dashboard's
 * `EventWorkspace`, so it needs its own smoke coverage per docs/CONTRIBUTING.md — the pure
 * access-decision logic is covered in tests/unit/event-access.test.ts, but only this run proves
 * the route itself enforces the session guard and that the workspace renders against it.
 */
test.describe("Event access API", () => {
  test("refuses an unauthenticated request", async ({ page }) => {
    const response = await page.request.get("/api/events");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  test("renders the connected-events workspace for a signed-in attendee", async ({ page }) => {
    const email = `e2e-events-attendee-${Date.now()}@example.com`;
    const password = "Password123!";

    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await page.locator("#name").fill("E2E Events Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Your connected events" })).toBeVisible({
      timeout: 10_000,
    });

    // The seed data includes a demo event open to registration, so a brand-new attendee sees it
    // as "attendee access" — proving the fetch to /api/events succeeded and was correctly scoped.
    await expect(page.getByText("attendee access")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "ConnectSphere Demo Summit" })).toBeVisible();
  });
});
