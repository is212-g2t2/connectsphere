import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const password = "EventRequests123!";

async function signUp(page: Page, role?: "event_organiser"): Promise<void> {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: role ? "Event organiser" : "Attendee",
      email: `event-request-${randomUUID()}@example.invalid`,
      password,
      ...(role ? { role } : {}),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe("Event request drafts", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await page.goto("/event-requests");
    await expect(page).toHaveURL(/\/login/);
  });

  test("lets an event organiser capture the full requirements and save", async ({ page }) => {
    await signUp(page, "event_organiser");

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Event requests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New event request" })).toBeVisible();

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Plan the year with members");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("25");
    await page.getByLabel("Description (optional)", { exact: true }).fill("Bring your own lunch");
    await page.getByLabel("Type of event (optional)", { exact: true }).fill("Workshop");
    await page
      .getByLabel("Venue requirements (optional)", { exact: true })
      .fill("Ground floor, near MRT");
    await page.getByLabel("Room-layout preference (optional)", { exact: true }).fill("U-shape");
    await page
      .getByLabel("Accessibility requirements (optional)", { exact: true })
      .fill("Step-free access");
    await page
      .getByLabel("Special arrangements (optional)", { exact: true })
      .fill("Quiet room available");

    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-11-18T09:30");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-11-18T12:45");
    await page.getByRole("button", { name: "Add proposed date" }).click();
    await page.getByLabel("Proposed start 2 (required)", { exact: true }).fill("2030-11-20T14:15");
    await page.getByLabel("Proposed end 2 (required)", { exact: true }).fill("2030-11-20T17:30");

    await page.getByRole("button", { name: "Add equipment" }).click();
    await page.getByLabel("Equipment type 1", { exact: true }).fill("Wireless microphone");
    await page.getByLabel("Quantity 1", { exact: true }).fill("2");

    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Draft saved.")).toBeVisible();
  });

  test("refuses an end date that is not later than its start", async ({ page }) => {
    await signUp(page, "event_organiser");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Event requests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New event request" })).toBeVisible();

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-11-18T09:30");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-11-18T09:30");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText(/later than the start/)).toBeVisible();
  });

  test("refuses an attendee the page and the dashboard link", async ({ page }) => {
    await signUp(page);

    await page.goto("/event-requests");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /welcome,/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Event requests", exact: true })).toHaveCount(0);
  });
});
