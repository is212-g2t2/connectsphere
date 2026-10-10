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

/**
 * PTR-8: the dashboard loader calls the `listEvents` server function and hands the widget each
 * role's own projection, so these runs exercise the real database relationships through the
 * interface — including venue staff being refused the event name. The refusal half of the
 * criterion (401/403) is not reachable through the UI and lives in the integration suite, at the
 * handler and middleware boundaries.
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
    // The registrations route is gone: the Attendee's registration reads as a card on the
    // dashboard.
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible();
    await expect(page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME })).toBeVisible();
    await expect(page.getByLabel("Your registration: Registered").first()).toBeVisible();
    // Structure, not hardcoded dates: the seed moves its window on every run. The card carries
    // no venue, so only the date and time read here; the venue stays on the event page.
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

    // The seed's attendee demo is a confirmed event with registration on, so a
    // brand-new attendee sees it as "attendee access".
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
    // Structure, not hardcoded dates: the seed moves its window on every run.
    await expect(page.getByText(ATTENDEE_DEMO_VENUE_NAME).first()).toBeVisible();
    await expect(page.getByText("Level 2, ConnectSphere Marina Centre").first()).toBeVisible();
    await expect(page.getByText(/Opens .+ – closes /)).toBeVisible();
    await expect(page.getByRole("heading", { name: "About Event" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Maps" })).toHaveCount(0);
    // These DOM absences guard the page component; the projection itself is pinned by the
    // integration key-set assertion.
    await expect(page.getByText("Venue request", { exact: true })).toHaveCount(0);
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

    // The seed keeps the Open Day's period open, with places left out of its 40.
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

  // PTR-111: the run adds a seeded Attendee as a VIP and removes the registration again, so
  // the net places on the seeded Open Day do not move for the PTR-45 run counting them. The
  // registrations section holds the one attendee table: Add VIP, search, add, then remove by bin.
  test("adds and removes a VIP through the registrations table (PTR-111)", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.getByRole("link", { name: ATTENDEE_DEMO_EVENT_NAME }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);

    await expect(page.getByRole("heading", { name: "Registrations" })).toBeVisible({
      timeout: 10_000,
    });
    // One view only: the old separate VIP list is gone.
    await expect(page.getByLabel("VIP registrations")).toHaveCount(0);

    await page.getByRole("button", { name: "Add VIP" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("searchbox", { name: "Search attendees" }).fill("demo@example");
    await dialog.getByRole("button", { name: "Add Demo User as a VIP" }).click();
    // The dialog stays open for further additions, inerting the page behind it.
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
    // PTR-31 AC2: timing, attendance, layout, accessibility and facilities — never the name. The
    // card is titled by the venue, and the event name appears nowhere on the dashboard.
    await expect(page.getByRole("link", { name: "Harbour Hall" })).toBeVisible();
    await expect(page.getByRole("heading", { name: DEMO_EVENT_NAME })).toHaveCount(0);
    await expect(page.getByText(DEMO_EVENT_NAME)).toHaveCount(0);
    // The event status reads as a pill; the venue request's own pending state lives on the event
    // page's request section.
    await expect(page.getByLabel("Status: Submitted")).toBeVisible();
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

    // Loader data, not a client fetch: an unauthenticated or empty HTML response would not carry
    // either string. React separates the access label's two text children with a comment node.
    expect(html.replaceAll("<!-- -->", "")).toContain("coordinator access");
    expect(html).toContain(DEMO_EVENT_NAME);
  });
});
