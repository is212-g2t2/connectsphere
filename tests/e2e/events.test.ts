import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { DEMO_EVENT_NAME, SEED_STAFF_PASSWORD } from "../../scripts/seed";

async function signInAsSeeded(page: Page, email: string): Promise<void> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function signUpAsOrganiser(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Events organiser",
      email: `events-${randomUUID()}@example.invalid`,
      password: "Events123!",
      role: "event_organiser",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * PTR-8: the dashboard loader calls the `listEvents` server function and hands the widget each
 * role's own projection, so these runs exercise the real database relationships through the
 * interface — including venue staff being refused the event name. The refusal half of the
 * criterion (401/403) is not reachable through the UI and lives in the integration suite, at the
 * handler and middleware boundaries.
 */
test.describe("Event access", () => {
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

    // The seed's demo request is submitted with registration enabled and an open window, so a
    // brand-new attendee sees it as "attendee access".
    await expect(page.getByText("attendee access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toBeVisible();
  });

  test("gives the assigned coordinator their event", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("coordinator access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toBeVisible();
  });

  test("gives the organiser the event they created", async ({ page }) => {
    await signInAsSeeded(page, "jane.doe@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("organiser access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toBeVisible();
  });

  test("gives venue staff their request and withholds the rest of the event", async ({ page }) => {
    await signInAsSeeded(page, "venue.staff.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("venue staff access").first()).toBeVisible({ timeout: 10_000 });
    // PTR-31 AC2: timing, attendance, layout, accessibility and facilities — never the name.
    await expect(page.getByRole("heading", { name: "Venue request" })).toBeVisible();
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toHaveCount(0);
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
  });

  test("gives technical support the equipment for their event", async ({ page }) => {
    await signInAsSeeded(page, "tech.support.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("technical support access").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toBeVisible();
    await expect(page.getByText("Equipment arrangements")).toBeVisible();
    await expect(page.getByText("Projector")).toBeVisible();
  });

  test("shows an unrelated organiser no events at all", async ({ page }) => {
    await signUpAsOrganiser(page);
    await page.goto("/dashboard");

    await expect(page.getByText("No events are currently connected to your account.")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("renders the connected events in the server response", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");

    const response = await page.request.get("/dashboard");
    const html = await response.text();

    // Loader data, not a client fetch: an unauthenticated or empty HTML response would not carry
    // either string. React separates the access label's two text children with a comment node.
    expect(html.replaceAll("<!-- -->", "")).toContain("coordinator access");
    expect(html).toContain(DEMO_EVENT_NAME);
  });
});
