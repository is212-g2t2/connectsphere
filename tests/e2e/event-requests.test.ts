import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";
import { chooseGroupValue, chooseSelectValue } from "./request-form";
import { signInAsStaff } from "./staff-auth";

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

/** Sign an organiser up from the header. Land on the form. */
async function openNewRequest(page: Page): Promise<void> {
  await signUp(page, "event_organiser");
  await page.goto("/dashboard");
  await waitForHydration(page);
  await page.getByRole("link", { name: "Event requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event requests" })).toBeVisible();
  await page.getByRole("link", { name: "New request" }).click();
  await expect(page.getByRole("heading", { name: "New event request" })).toBeVisible();
  await waitForHydration(page);
}

/** Create a fresh organiser draft from the list. Return to the list. */
async function draftFromList(page: Page, name: string): Promise<void> {
  await openNewRequest(page);
  await page.getByLabel("Event name (required)", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("link", { name: "Back to event requests" }).click();
  await expect(page.getByRole("heading", { name: "Event requests" })).toBeVisible();
}

test.describe("Event request drafts", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await page.goto("/event-requests");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/event-requests/reopenDraft/1");
    await expect(page).toHaveURL(/\/login/);
  });

  test("lets an event organiser capture the full requirements and save", async ({ page }) => {
    await openNewRequest(page);

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Plan the year with members");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("25");
    await page.getByLabel("Description (required)", { exact: true }).fill("Bring your own lunch");
    await chooseSelectValue(page, "Type of event (optional)", "Workshop");
    await chooseGroupValue(page, "Venue requirements (required)", "Ground floor, near MRT");
    await chooseSelectValue(page, "Room-layout preference (required)", "U-shape");
    await chooseGroupValue(page, "Accessibility requirements (required)", "Step-free access");
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

    await page.getByRole("checkbox", { name: "Require attendee registration" }).click();
    await page.getByLabel("Registration capacity (required)", { exact: true }).fill("30");
    await page
      .getByLabel("Registration opens (required)", { exact: true })
      .fill("2030-11-01T09:00");
    await page
      .getByLabel("Registration closes (required)", { exact: true })
      .fill("2030-11-08T17:00");

    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Draft saved.")).toBeVisible();
  });

  test("refuses an enabled registration missing its terms, naming each", async ({ page }) => {
    await openNewRequest(page);

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByRole("checkbox", { name: "Require attendee registration" }).click();
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(
      page.getByText("Registration capacity is required when registration is enabled")
    ).toBeVisible();
    await expect(
      page.getByText(
        "A registration opening date and time is required when registration is enabled"
      )
    ).toBeVisible();
    await expect(
      page.getByText(
        "A registration closing date and time is required when registration is enabled"
      )
    ).toBeVisible();
    await expect(page.getByText("Draft saved.")).toHaveCount(0);
  });

  test("shows the refusal instead of a saved draft when the session ends mid-sitting", async ({
    page,
    context,
  }) => {
    await openNewRequest(page);

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    // Sign out from another tab. The page keeps its held draft id and loses the session. The
    // next in-app save meets a refusal. The app records no save.
    const otherTab = await context.newPage();
    await otherTab.goto("/dashboard");
    // PTR-73 renders the header signed-in in the server markup. The button accepts clicks
    // before React attaches its handler. Without this wait, the click lands on inert markup.
    await waitForHydration(otherTab);
    await otherTab.getByRole("button", { name: "Account menu" }).click();
    await otherTab.getByRole("menuitem", { name: "Sign out" }).click();
    await otherTab.waitForURL("/");
    await otherTab.close();

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("alert")).toContainText("Unauthorized");
    await expect(page.getByText("Draft saved.")).toHaveCount(0);
  });

  test("refuses an end date that is not later than its start", async ({ page }) => {
    await openNewRequest(page);

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
    // Neither page paints first. `beforeLoad` redirects before rendering.
    await expect(page.getByRole("heading", { name: "Event requests" })).toHaveCount(0);
    await page.goto("/event-requests/new");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "New event request" })).toHaveCount(0);
    await page.goto("/event-requests/reopenDraft/1");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Edit event request" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Event requests", exact: true })).toHaveCount(0);
  });
});

test.describe("Event request submission (PTR-13)", () => {
  test("submits a complete request and confirms it", async ({ page }) => {
    await openNewRequest(page);

    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Plan the year with members");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("25");
    await page.getByLabel("Description (required)", { exact: true }).fill("Bring your own lunch");
    await chooseGroupValue(page, "Venue requirements (required)", "Ground floor, near MRT");
    await chooseSelectValue(page, "Room-layout preference (required)", "U-shape");
    await chooseGroupValue(page, "Accessibility requirements (required)", "Step-free access");
    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-11-18T09:30");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-11-18T12:45");

    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(page.getByText("Request submitted.")).toBeVisible();
    // The submitted request is no longer editable here. The panel points at the routes that
    // can change it. No form remains to refuse on save.
    await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    await expect(page.getByText(/raise a change request/)).toBeVisible();
  });

  test("refuses a submission missing mandatory fields, naming each", async ({ page }) => {
    await openNewRequest(page);

    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(
      page.getByText(
        "This request is missing: Event name, Purpose, Proposed dates and times, Expected attendance, Description, Venue requirements, Room-layout preference, Accessibility requirements"
      )
    ).toBeVisible();
    await expect(page.getByText("Request submitted.")).toHaveCount(0);
  });
});

test.describe("Event request list (PTR-14)", () => {
  test("lists drafts and submitted requests distinguishably and opens one", async ({ page }) => {
    await openNewRequest(page);

    // One draft, saved incomplete.
    await page.getByLabel("Event name (required)", { exact: true }).fill("Community workshop");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    // One complete request, submitted.
    await page.getByRole("link", { name: "Back to event requests" }).click();
    await page.getByRole("link", { name: "New request" }).click();
    await expect(page.getByRole("heading", { name: "New event request" })).toBeVisible();
    await waitForHydration(page);
    await page.getByLabel("Event name (required)", { exact: true }).fill("Annual dinner");
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Thank the volunteers");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("120");
    await page.getByLabel("Description (required)", { exact: true }).fill("Dinner and awards");
    await chooseGroupValue(page, "Venue requirements (required)", "Banquet hall");
    await chooseSelectValue(page, "Room-layout preference (required)", "Banquet");
    await chooseGroupValue(page, "Accessibility requirements (required)", "None");
    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-12-01T18:00");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-12-01T22:00");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Request submitted.")).toBeVisible();

    await page.getByRole("link", { name: "Back to event requests" }).click();
    await expect(page.getByRole("heading", { name: "Event requests" })).toBeVisible();

    const dinner = page.getByRole("row", { name: /Annual dinner/ });
    const workshop = page.getByRole("row", { name: /Community workshop/ });
    await expect(dinner).toContainText("Submitted");
    await expect(dinner).toContainText("1 Dec 2030, 18:00");
    // PTR-144: a fresh submission waits unassigned. No Coordinator holds it yet.
    await expect(dinner).toContainText("Not yet assigned");
    await expect(workshop).toContainText("Draft");

    await dinner.getByRole("link", { name: "Annual dinner" }).click();
    // A submitted request opens on the universal event page. It uses no detail route.
    await expect(page).toHaveURL(/\/events\/\d+/);
    await expect(page.getByRole("heading", { name: "Annual dinner" })).toBeVisible();
    await expect(page.getByText("Thank the volunteers")).toBeVisible();
    await expect(page.getByText("1 Dec 2030, 18:00 – 22:00")).toBeVisible();
    await expect(page.getByLabel("Status: Submitted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  });

  test("answers not found for another organiser's request", async ({ page }) => {
    await openNewRequest(page);
    await page.getByLabel("Event name (required)", { exact: true }).fill("Mine");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();
    await page.getByRole("link", { name: "Back to event requests" }).click();
    const href = (await page.getByRole("link", { name: "Mine" }).getAttribute("href")) ?? "";
    // A draft links back to its reopen route. A submitted request links to its event page.
    expect(href).toMatch(/\/event-requests\/reopenDraft\/\d+$/);

    // Clear the session and sign a second organiser up in the same browser context.
    await page.context().clearCookies();
    await signUp(page, "event_organiser");
    await page.goto(href);
    await expect(page.getByRole("heading", { name: "Mine" })).toHaveCount(0);
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});

test.describe("Event request resume and delete (PTR-12)", () => {
  test("answers not found for a draft that does not exist (AC1)", async ({ page }) => {
    await signUp(page, "event_organiser");
    await page.goto("/event-requests/reopenDraft/999999");
    await expect(page.getByText(/not found/i)).toBeVisible();
  });

  test("resumes a draft, edits it, and keeps a single row (AC1, AC2)", async ({ page }) => {
    await draftFromList(page, "Community workshop");

    const row = page.getByRole("row", { name: /Community workshop/ });
    await expect(row).toContainText("Draft");
    await row.getByRole("link", { name: "Resume" }).click();

    await expect(page.getByRole("heading", { name: "Edit event request" })).toBeVisible();
    await expect(page.getByLabel("Event name (required)", { exact: true })).toHaveValue(
      "Community workshop"
    );

    await page
      .getByLabel("Event name (required)", { exact: true })
      .fill("Community workshop, resumed");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible();

    await page.getByRole("link", { name: "Back to event requests" }).click();
    await expect(page.getByRole("row", { name: /Community workshop, resumed/ })).toContainText(
      "Draft"
    );
    // The first save after a reopen updates the loaded row. A duplicated insert creates two.
    await expect(page.getByRole("row", { name: /Community workshop/ })).toHaveCount(1);
  });

  test("keeps the draft when the delete is cancelled and removes it on confirm (AC3)", async ({
    page,
  }) => {
    await draftFromList(page, "Throwaway draft");

    const row = page.getByRole("row", { name: /Throwaway draft/ });
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Delete this draft?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Delete this draft?")).toHaveCount(0);
    await expect(row).toContainText("Draft");

    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("row", { name: /Throwaway draft/ })).toHaveCount(0);
    await expect(page.getByText(/No requests yet/)).toBeVisible();
  });
});

test.describe("Coordinator assignment (PTR-144)", () => {
  test("leaves a fresh submission unassigned on the list and detail", async ({ page }) => {
    await openNewRequest(page);
    await page.getByLabel("Event name (required)", { exact: true }).fill("Board retreat");
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Plan the year");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("12");
    await page.getByLabel("Description (required)", { exact: true }).fill("Board planning retreat");
    await chooseGroupValue(page, "Venue requirements (required)", "Boardroom with projector");
    await chooseSelectValue(page, "Room-layout preference (required)", "Boardroom");
    await chooseGroupValue(page, "Accessibility requirements (required)", "None");
    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-12-01T09:00");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-12-01T17:00");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Request submitted.")).toBeVisible();

    await page.getByRole("link", { name: "Back to event requests" }).click();
    const row = page.getByRole("row", { name: /Board retreat/ });
    // A fresh submission waits in the Lead's queue. No Coordinator holds it yet.
    await expect(row).toContainText("Not yet assigned");

    await row.getByRole("link", { name: "Board retreat" }).click();
    // The contact card names no Coordinator while the event is unassigned.
    const record = page.getByRole("region", { name: "Requests & messages" });
    await expect(record.getByText("Not yet assigned")).toBeVisible();
    await expect(record.getByRole("link", { name: "coordinator.seed@example.com" })).toHaveCount(0);
  });

  test("gives the unassigned queue to the Lead, assignments to a Coordinator, and refuses it to an organiser", async ({
    page,
    browser,
    baseURL,
  }) => {
    await openNewRequest(page);
    const eventName = `Queue visibility ${randomUUID()}`;
    await page.getByLabel("Event name (required)", { exact: true }).fill(eventName);
    await page.getByLabel("Purpose (required)", { exact: true }).fill("Plan the year");
    await page.getByLabel("Expected attendance (required)", { exact: true }).fill("12");
    await page.getByLabel("Description (required)", { exact: true }).fill("Planning session");
    await chooseGroupValue(page, "Venue requirements (required)", "Meeting room");
    await chooseSelectValue(page, "Room-layout preference (required)", "Classroom");
    await chooseGroupValue(page, "Accessibility requirements (required)", "None");
    await page.getByLabel("Proposed start 1 (required)", { exact: true }).fill("2030-12-01T09:00");
    await page.getByLabel("Proposed end 1 (required)", { exact: true }).fill("2030-12-01T17:00");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Request submitted.")).toBeVisible();

    // The Lead reads the unassigned queue. The fresh submission waits there.
    const leadContext = await browser.newContext({ baseURL });
    const leadPage = await leadContext.newPage();
    const coordinatorContext = await browser.newContext({ baseURL });
    const coordinatorPage = await coordinatorContext.newPage();
    try {
      await signInAsStaff(leadPage, "event_coordinator_lead");
      await leadPage.goto("/coordination");
      await expect(
        leadPage.getByRole("heading", { name: "Unassigned requests", level: 2 })
      ).toBeVisible();
      await expect(leadPage.getByRole("link", { name: eventName })).toBeVisible();

      // A Coordinator reads assignments only. The unassigned queue never renders.
      await signInAsStaff(coordinatorPage, "event_coordinator");
      await coordinatorPage.goto("/coordination");
      await expect(coordinatorPage.getByRole("heading", { name: "Coordination" })).toBeVisible();
      await expect(coordinatorPage.getByRole("heading", { name: "Assigned to you" })).toBeVisible();
      await expect(
        coordinatorPage.getByRole("heading", { name: "Unassigned requests" })
      ).toHaveCount(0);
      await expect(coordinatorPage.getByRole("link", { name: eventName })).toHaveCount(0);
    } finally {
      await leadContext.close();
      await coordinatorContext.close();
    }

    await page.context().clearCookies();
    await signUp(page, "event_organiser");
    await page.goto("/coordination");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Coordination", exact: true })).toHaveCount(0);
  });
});
