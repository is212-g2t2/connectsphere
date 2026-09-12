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

  test("lets an event organiser save a partial draft", async ({ page }) => {
    await signUp(page, "event_organiser");

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Event requests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New event request" })).toBeVisible();

    await page.getByLabel("Event name", { exact: true }).fill("Community workshop");
    await page.getByLabel("Expected attendance", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Draft saved.")).toBeVisible();
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
