import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  ATTENDEE_DEMO_EVENT_NAME,
  ATTENDEE_DEMO_VENUE_NAME,
  DEMO_EVENT_NAME,
  SEED_STAFF_PASSWORD,
} from "../../scripts/seed";
import { waitForHydration } from "./hydration";

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

/** PTR-8: the dashboard loader calls `listEvents` and gives each role its own projection. These
 * tests check the database relationships through the UI, including the hidden event name for Venue
 * Staff. The integration suite checks handler and middleware refusals (401/403).
 */
test.describe("Event access", () => {
  test("answers not found for the removed registrations route", async ({ page }) => {
    await page.goto("/registrations");

    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your events" })).toHaveCount(0);
  });

  test("answers not found for the removed registrations route when signed in", async ({ page }) => {
    await signUpAsOrganiser(page);
    await page.goto("/registrations");

    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "My registrations" })).toHaveCount(0);
  });

  test("shows the signed-in Attendee their registration on the dashboard", async ({ page }) => {
    await signInAsSeeded(page, "john.doe@example.com");
    // The registrations route returns 404. Show the Attendee's registration as a dashboard card.
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible();
    await expect(page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME })).toBeVisible();
    await expect(page.getByLabel("Your registration: Registered").first()).toBeVisible();
    // The seed changes the event dates on every run. Check the card structure, date, and time; the
    // card omits the venue, which stays on the event page.
    await expect(page.getByText(/\d{1,2} [A-Z][a-z]{2} \d{4}/).first()).toBeVisible();
    await expect(page.getByText(/\d{2}:\d{2}–\d{2}:\d{2}/).first()).toBeVisible();
  });

  test("renders the connected-events workspace for a signed-in attendee", async ({ page }) => {
    const email = `e2e-events-attendee-${Date.now()}@example.com`;
    const password = "Password123!";

    await page.goto("/signup");
    await waitForHydration(page);
    await page.locator("#name").fill("E2E Events Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/dashboard");

    // The seed's confirmed demo event has registration enabled, so a new Attendee sees "attendee access".
    await expect(page.getByText("attendee access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME })).toBeVisible();
  });

  test("opens a confirmed event and shows only its published details", async ({ page }) => {
    const email = `e2e-events-page-${Date.now()}@example.com`;
    const password = "Password123!";

    await page.goto("/signup");
    await waitForHydration(page);
    await page.locator("#name").fill("E2E Events Page Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME }).click();

    // A published event has its own page under its id.
    await expect(page).toHaveURL(/\/events\/\d+/);
    await expect(page.getByRole("heading", { name: ATTENDEE_DEMO_EVENT_NAME })).toBeVisible();
    await expect(page.getByText("An open day for new members: meet the organisers")).toBeVisible();
    // Check the structure because the seed changes its dates on every run.
    await expect(page.getByText(ATTENDEE_DEMO_VENUE_NAME).first()).toBeVisible();
    await expect(page.getByText("Level 2, ConnectSphere Marina Centre").first()).toBeVisible();
    await expect(page.getByText(/Opens .+ – closes /)).toBeVisible();
    await expect(page.getByRole("heading", { name: "About Event" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Maps" })).toHaveCount(0);
    // These DOM checks cover the page. The integration test checks the projection's keys.
    await expect(page.getByText("What was requested", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Equipment arrangements")).toHaveCount(0);
    await expect(page.getByText("Expected attendance")).toHaveCount(0);
  });

  test("registers a new attendee for a published event and notifies them (PTR-45)", async ({
    page,
  }) => {
    const email = `e2e-events-register-${Date.now()}@example.com`;
    const password = "Password123!";

    await page.goto("/signup");
    await waitForHydration(page);
    await page.locator("#name").fill("E2E Registering Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/dashboard");
    await page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);
    await waitForHydration(page);

    // The seed keeps Open Day registration open and leaves some of its 40 places available.
    const before = await page.getByText(/^\d+ \/ 40 registered$/).textContent();
    const taken = Number(before?.split(" ")[0]);
    await page.getByRole("button", { name: "Register" }).click();

    await expect(page.getByText("You're registered")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`${taken + 1} / 40 registered`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Register" })).toHaveCount(0);

    await page.goto("/notifications");
    await expect(
      page.getByText(`You are registered for ${ATTENDEE_DEMO_EVENT_NAME}`)
    ).toBeVisible();
  });

  test("lets an attendee cancel or confirm withdrawal, then register again (PTR-47)", async ({
    page,
  }) => {
    const email = `e2e-events-withdraw-${Date.now()}@example.com`;
    const password = "Password123!";

    await page.goto("/signup");
    await waitForHydration(page);
    await page.locator("#name").fill("E2E Withdrawing Attendee");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirmPassword").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/dashboard");
    await page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText("You're registered")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Withdraw registration" }).click();
    await expect(
      page.getByText(
        `Are you sure you want to withdraw from ${ATTENDEE_DEMO_EVENT_NAME}? Your place will be freed.`
      )
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("You're registered")).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw registration" })).toBeVisible();

    await page.getByRole("button", { name: "Withdraw registration" }).click();
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByRole("button", { name: "Register" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("You're registered")).toHaveCount(0);

    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText("You're registered")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Withdraw registration" })).toBeVisible();
  });

  test("gives the assigned coordinator their event", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("coordinator access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: DEMO_EVENT_NAME })).toBeVisible();
  });

  // PTR-111: Add a seeded Attendee as a VIP, then remove the registration. This keeps the place
  // count unchanged for the PTR-45 test. The registrations section has one attendee table: add a
  // VIP, search, add them, then remove them.
  test("adds and removes a VIP through the registrations table (PTR-111)", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);

    await expect(page.getByRole("heading", { name: "Registrations" })).toBeVisible({
      timeout: 10_000,
    });
    // Use one view; the separate VIP list is gone.
    await expect(page.getByLabel("VIP registrations")).toHaveCount(0);

    await page.getByRole("button", { name: "Add VIP" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("searchbox", { name: "Search attendees" }).fill("demo@example");
    await dialog.getByRole("button", { name: "Add Demo User as a VIP" }).click();
    // Keep the dialog open for more additions and disable the page behind it.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const table = page.getByRole("table");
    await expect(table.getByRole("cell", { name: "Demo User", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(table.getByText("VIP").first()).toBeVisible();

    await table.getByRole("button", { name: "Remove VIP registration: Demo User" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(table.getByRole("cell", { name: "Demo User", exact: true })).toHaveCount(0);
  });

  test("gives the organiser the event they created", async ({ page }) => {
    await signInAsSeeded(page, "jane.doe@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("organiser access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: DEMO_EVENT_NAME })).toBeVisible();
  });

  test("gives venue staff their request and withholds the rest of the event", async ({ page }) => {
    await signInAsSeeded(page, "venue.staff.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("venue staff access").first()).toBeVisible({ timeout: 10_000 });
    // PTR-31 AC2: show the time, attendance, layout, accessibility, and facilities, not the event
    // name. The venue titles the card.
    await expect(page.getByRole("link", { name: "Harbour Hall" })).toBeVisible();
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toHaveCount(0);
    await expect(page.getByText(DEMO_EVENT_NAME)).toHaveCount(0);
    // Show the event status in a pill. The venue request's pending state appears in the event page's
    // request section. The seed adds shared queue rows, so scope the badge to the demo card.
    const card = page.locator('div[data-slot="card"]', {
      has: page.getByRole("link", { name: "Harbour Hall", exact: true }),
    });
    await expect(card.getByLabel("Status: Submitted")).toBeVisible();
  });

  test("gives technical support their event, with the equipment on its page", async ({ page }) => {
    await signInAsSeeded(page, "tech.support.seed@example.com");
    await page.goto("/dashboard");

    await expect(page.getByText("technical support access").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: DEMO_EVENT_NAME })).toBeVisible();
    await expect(page.getByText("Equipment arrangements")).toHaveCount(0);

    await page.getByRole("link", { name: DEMO_EVENT_NAME }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);
    await expect(page.getByRole("heading", { name: "Equipment lines" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Projector/ })).toBeVisible();
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

    // Loader data appears in server HTML; an unauthenticated or empty response lacks both strings.
    // React separates the two access label text nodes with a comment node.
    expect(html.replaceAll("<!-- -->", "")).toContain("coordinator access");
    expect(html).toContain(DEMO_EVENT_NAME);
  });
});
