// Browser actions share a page and must run in order.
// oxlint-disable node/no-process-env, no-await-in-loop
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
import { registerAccount } from "./register";
import { signInAsStaff } from "./staff-auth";

const password = "Coordinate123!";
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});
test.afterAll(async () => {
  await pool.end();
});

async function register(page: Page, role: "event_organiser" | "event_coordinator", name: string) {
  return registerAccount(database, page, { role, name, password });
}

/** Seed a submitted request for `coordinatorId`. Track the organiser id before inserting the
 * request so cleanup can remove it if the insert fails.
 */
async function seedAssignedRequest(
  ids: string[],
  coordinatorId: string,
  overrides: Partial<typeof schema.eventRequests.$inferInsert> = {}
) {
  const organiserId = randomUUID();
  await database.insert(schema.user).values({
    id: organiserId,
    name: "Seeded Organiser",
    email: `${organiserId}@example.invalid`,
    role: "event_organiser",
  });
  ids.push(organiserId);
  const [request] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId,
      eventName: `Assigned ${randomUUID()}`,
      status: "submitted",
      submittedAt: new Date(),
      assignedCoordinatorId: coordinatorId,
      assignedAt: new Date(),
      ...overrides,
    })
    .returning();
  return request;
}

test("answers not found for the removed coordination detail", async ({ page }) => {
  await page.goto("/coordination/1");
  await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
});

test("answers not found for a junk request id instead of the error boundary", async ({ page }) => {
  const coordinator = await register(page, "event_coordinator", "Junk Id Coordinator");
  try {
    await page.goto("/events/abc");
    await expect(page.getByText(/not found/i)).toBeVisible();
  } finally {
    await database.delete(schema.user).where(eq(schema.user.id, coordinator.id));
  }
});

test("a Lead assigns an unassigned request at once and notifies the Coordinator and Organiser", async ({
  page,
  browser,
  baseURL,
}) => {
  const coordinatorContext = await browser.newContext({ baseURL });
  const organiserContext = await browser.newContext({ baseURL });
  const coordinatorPage = await coordinatorContext.newPage();
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const coordinator = await register(
      coordinatorPage,
      "event_coordinator",
      "Assigned Coordinator"
    );
    ids.push(coordinator.id);
    const organiser = await register(organiserPage, "event_organiser", "Assign Organiser");
    ids.push(organiser.id);
    const eventName = `Assign ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        purpose: "Coordinate a workshop",
        expectedAttendance: 25,
      })
      .returning();

    // The Lead opens the queue row and assigns the Coordinator.
    await signInAsStaff(page, "event_coordinator_lead");
    await page.goto("/coordination");
    await page.getByRole("link", { name: eventName }).click();
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Assign a Coordinator" })).toBeVisible();
    await page.locator("#lead-assignment-coordinator").click();
    await page.getByRole("option", { name: coordinator.email }).click();
    await page.getByRole("button", { name: "Assign Coordinator" }).click();
    await expect(page.getByRole("button", { name: "Reassign Coordinator" })).toBeVisible();

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored.assignedCoordinatorId).toBe(coordinator.id);

    // The move is immediate: the incoming Coordinator reaches the event, and the Organiser sees
    // the new holder.
    await coordinatorPage.goto(`/events/${request.id}`);
    await expect(coordinatorPage.getByRole("heading", { name: eventName })).toBeVisible();
    await organiserPage.goto(`/events/${request.id}`);
    await expect(
      organiserPage
        .getByRole("region", { name: "Requests & messages" })
        .getByRole("link", { name: coordinator.email })
    ).toBeVisible();

    const assignedEmail = await waitForEmail(
      coordinator.email,
      `Event assigned to you: ${eventName}`
    );
    expect(assignedEmail).toContain(eventName);
    const organiserEmail = await waitForEmail(
      organiser.email,
      `Event Coordinator assigned: ${eventName}`
    );
    expect(organiserEmail).toContain(coordinator.name);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await coordinatorContext.close();
    await organiserContext.close();
  }
});

test("a Lead reassigns immediately and notifies the outgoing, incoming and Organiser", async ({
  page,
  browser,
  baseURL,
}) => {
  const outgoingContext = await browser.newContext({ baseURL });
  const incomingContext = await browser.newContext({ baseURL });
  const organiserContext = await browser.newContext({ baseURL });
  const outgoingPage = await outgoingContext.newPage();
  const incomingPage = await incomingContext.newPage();
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const outgoing = await register(outgoingPage, "event_coordinator", "Reassigned Outgoing");
    ids.push(outgoing.id);
    const incoming = await register(incomingPage, "event_coordinator", "Reassigned Incoming");
    ids.push(incoming.id);
    const organiser = await register(organiserPage, "event_organiser", "Reassign Organiser");
    ids.push(organiser.id);
    const request = await seedAssignedRequest(ids, outgoing.id, {
      eventName: `Reassign ${randomUUID()}`,
      // Keep the registered Organiser as the owner, so its notification has a recipient to check.
      organiserId: organiser.id,
    });
    const eventName = request.eventName;

    await signInAsStaff(page, "event_coordinator_lead");
    await page.goto(`/events/${request.id}`);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Assign a Coordinator" })).toBeVisible();
    await page.locator("#lead-assignment-coordinator").click();
    await page.getByRole("option", { name: incoming.email }).click();
    await page.getByRole("button", { name: "Reassign Coordinator" }).click();
    // The move commits before the page re-reads; the current holder then names the incoming one.
    await expect(page.getByRole("link", { name: incoming.email })).toBeVisible();

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored.assignedCoordinatorId).toBe(incoming.id);

    // Access moves at once, with no acceptance step.
    await outgoingPage.goto(`/events/${request.id}`);
    await expect(outgoingPage.getByText(/not found/i)).toBeVisible();
    await incomingPage.goto(`/events/${request.id}`);
    await expect(incomingPage.getByRole("heading", { name: eventName })).toBeVisible();

    const outgoingEmail = await waitForEmail(outgoing.email, `Event reassigned: ${eventName}`);
    expect(outgoingEmail).toContain(incoming.name);
    const incomingEmail = await waitForEmail(incoming.email, `Event assigned to you: ${eventName}`);
    expect(incomingEmail).toContain(eventName);
    const organiserEmail = await waitForEmail(
      organiser.email,
      `Event Coordinator changed: ${eventName}`
    );
    expect(organiserEmail).toContain(incoming.name);
    expect(organiserEmail).toContain(outgoing.name);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await outgoingContext.close();
    await incomingContext.close();
    await organiserContext.close();
  }
});

test("shows the unassigned queue to the Lead and hides it from Coordinators", async ({
  page,
  browser,
  baseURL,
}) => {
  const coordinatorContext = await browser.newContext({ baseURL });
  const coordinatorPage = await coordinatorContext.newPage();
  const ids: string[] = [];
  try {
    // A fresh submission waits unassigned: no Coordinator holds it.
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Queue Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Unassigned ${randomUUID()}`;
    await database.insert(schema.eventRequests).values({
      organiserId,
      eventName,
      status: "submitted",
      submittedAt: new Date(),
    });

    // The Lead reads the unassigned queue and opens the detail, where the assignment form is the
    // only action (PTR-145). No handover or claim action is offered.
    await signInAsStaff(page, "event_coordinator_lead");
    await page.goto("/coordination");
    await expect(
      page.getByRole("heading", { name: "Unassigned requests", level: 1 })
    ).toBeVisible();
    await page.getByRole("link", { name: eventName }).click();
    await waitForHydration(page);
    await expect(page.getByText("unassigned request", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assign a Coordinator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign Coordinator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign to me" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hand over this request" })).toHaveCount(0);

    // A Coordinator never sees the unassigned queue: neither the heading nor the row.
    await signInAsStaff(coordinatorPage, "event_coordinator");
    await coordinatorPage.goto("/coordination");
    await expect(coordinatorPage.getByRole("heading", { name: "Unassigned requests" })).toHaveCount(
      0
    );
    await expect(coordinatorPage.getByRole("link", { name: eventName })).toHaveCount(0);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await coordinatorContext.close();
  }
});
test("lists a submitted request assigned to the Coordinator", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "List Coordinator");
    ids.push(coordinator.id);
    const request = await seedAssignedRequest(ids, coordinator.id, {
      eventName: `Assigned List ${randomUUID()}`,
    });

    await page.goto("/coordination");
    await expect(page.getByRole("heading", { name: "Assigned to you" })).toBeVisible();
    await expect(page.getByRole("link", { name: request.eventName })).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

function fieldValue(scope: Page | Locator, term: string) {
  return scope.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

test("Organiser amends the concerned fields, replies, and notifies the Coordinator", async ({
  page,
  browser,
  baseURL,
}) => {
  const organiserContext = await browser.newContext({ baseURL });
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Reply Coordinator");
    ids.push(coordinator.id);
    const organiser = await register(organiserPage, "event_organiser", "Reply Organiser");
    ids.push(organiser.id);
    const eventName = `Clarification reply ${randomUUID()}`;
    const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        submittedAt: new Date(),
        status: "under_review",
        eventName,
        purpose: "Community workshop",
        expectedAttendance: 100,
        roomLayoutPreference: "Theatre",
        proposedDates: [{ start: `${date}T09:00`, end: `${date}T17:00` }],
      })
      .returning();
    const question = "Please confirm attendance and the room layout.";
    const reply = "We expect 120 guests.\nPlease use a Classroom layout.";

    await page.goto(`/events/${request.id}`);
    await waitForHydration(page);
    await page.getByLabel("What needs clarification").fill(question);
    await page.getByRole("checkbox", { name: "Expected attendance", exact: true }).check();
    await page.getByRole("checkbox", { name: "Room-layout preference", exact: true }).check();
    await page.getByRole("button", { name: "Send clarification request" }).click();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting organiser", { exact: true })).toBeVisible();

    await organiserPage.goto(`/events/${request.id}`);
    await waitForHydration(organiserPage);
    await expect(organiserPage.getByLabel("Event name (required)")).toBeDisabled();
    await expect(organiserPage.getByLabel("Purpose (required)")).toBeDisabled();
    await organiserPage.getByLabel("Expected attendance (required)").fill("120");
    await organiserPage.getByLabel("Room-layout preference (optional)").fill("Classroom");
    await organiserPage.getByLabel("Your reply").fill(reply);
    await organiserPage.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(organiserPage.getByText("Under review", { exact: true })).toBeVisible();
    await expect(organiserPage.getByText(reply, { exact: true })).toBeVisible();
    await expect(organiserPage.getByRole("button", { name: "Send reply" })).toHaveCount(0);
    // Read the record in the information section. The venue section shows the same fields.
    const record = organiserPage.getByRole("region", { name: "Event information" });
    await expect(fieldValue(record, "Expected attendance")).toHaveText("120");
    // PTR-19: the reply records the change and shows the Coordinator its old and new values.
    await expect(organiserPage.getByText("Expected attendance: 100 → 120")).toBeVisible();
    await expect(
      organiserPage.getByText("Room-layout preference: Theatre → Classroom")
    ).toBeVisible();

    const email = await waitForEmail(coordinator.email, `Clarification replied: ${eventName}`);
    expect(email).toContain(question);
    expect(email).toContain("We expect 120 guests.");
    expect(email).toContain(`/events/${request.id}`);
    await page.reload();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    // Show the shared requirements to the Coordinator. The venue section labels the layout
    // "Layout"; the request form calls it "Room-layout preference".
    await expect(fieldValue(page.getByRole("region", { name: "Venue" }), "Layout")).toHaveText(
      "Classroom"
    );
    await expect(page.getByRole("button", { name: "Send reply", exact: true })).toHaveCount(0);
    await organiserPage.reload();
    await expect(organiserPage.getByText(reply, { exact: true })).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await organiserContext.close();
  }
});

test("a reply to a second question never reverts the first reply's amendment", async ({
  browser,
  baseURL,
}) => {
  const organiserContext = await browser.newContext({ baseURL });
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const coordinatorId = randomUUID();
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "Two Question Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });
    ids.push(coordinatorId);
    const organiser = await register(organiserPage, "event_organiser", "Two Question Organiser");
    ids.push(organiser.id);
    const eventName = `Two questions ${randomUUID()}`;
    const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date(),
        submittedAt: new Date(),
        status: "awaiting_organiser",
        eventName,
        purpose: "Community workshop",
        expectedAttendance: 100,
        proposedDates: [{ start: `${date}T09:00`, end: `${date}T17:00` }],
      })
      .returning();
    // Both questions accept the attendance, so one page load shows two reply forms with the same
    // value of 100. Use different timestamps to check the loader's order.
    const clarifications = await database
      .insert(schema.clarificationRequests)
      .values([
        {
          eventRequestId: request.id,
          coordinatorId,
          body: "How many guests?",
          permittedFields: ["expectedAttendance"],
          createdAt: new Date("2026-09-22T01:00:00Z"),
        },
        {
          eventRequestId: request.id,
          coordinatorId,
          body: "Confirm the guest count.",
          permittedFields: ["expectedAttendance"],
          createdAt: new Date("2026-09-22T02:00:00Z"),
        },
      ])
      .returning();
    const [firstQuestion, secondQuestion] = clarifications;
    if (!firstQuestion || !secondQuestion) throw new Error("Expected two clarifications");

    await organiserPage.goto(`/events/${request.id}`);
    await waitForHydration(organiserPage);
    await expect(organiserPage.getByLabel("Your reply")).toHaveCount(2);

    await organiserPage
      .locator(`#clarification-${firstQuestion.id}-expectedAttendance`)
      .fill("120");
    await organiserPage
      .locator(`#clarification-${firstQuestion.id}-replyBody`)
      .fill("We now expect 120 guests.");
    await organiserPage.getByRole("button", { name: "Send reply", exact: true }).first().click();

    // The remaining form must use the reloaded request, not its old value of 100. Wait for its
    // value to change; reply text alone is not enough because the answered form stays mounted until
    // reload completes.
    await expect(
      organiserPage.locator(`#clarification-${secondQuestion.id}-expectedAttendance`)
    ).toHaveValue("120");
    await expect(organiserPage.getByLabel("Your reply")).toHaveCount(1);
    await expect(
      organiserPage.getByText("We now expect 120 guests.", { exact: true })
    ).toBeVisible();

    // The second reply does not change attendance, so it must not submit the old value of 100.
    await organiserPage
      .locator(`#clarification-${secondQuestion.id}-replyBody`)
      .fill("The count is unchanged.");
    await organiserPage.getByRole("button", { name: "Send reply", exact: true }).click();

    await expect(organiserPage.getByText("The count is unchanged.", { exact: true })).toBeVisible();
    await expect(organiserPage.getByText("How many guests?", { exact: true })).toBeVisible();
    await expect(
      organiserPage.getByText("Confirm the guest count.", { exact: true })
    ).toBeVisible();
    await expect(
      fieldValue(
        organiserPage.getByRole("region", { name: "Event information" }),
        "Expected attendance"
      )
    ).toHaveText("120");

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored.expectedAttendance).toBe(120);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await organiserContext.close();
  }
});

test("shows every organiser-supplied field on the event page", async ({ page }) => {
  const ids: string[] = [];
  try {
    // Show the read-only record on the Organiser's event page. The Coordinator gets an edit form
    // only after approval.
    const organiser = await register(page, "event_organiser", "Detail Organiser");
    ids.push(organiser.id);
    const coordinatorId = randomUUID();
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "Detail Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });
    ids.push(coordinatorId);
    const eventName = `Full Detail ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date(),
        purpose: "Quarterly town hall",
        description: "All-staff briefing with Q&A",
        eventType: "Town hall",
        expectedAttendance: 150,
        venueRequirements: "Auditorium with stage",
        roomLayoutPreference: "Theatre",
        accessibilityRequirements: "Wheelchair-accessible seating",
        specialArrangements: "Live captioning",
        proposedDates: [{ start: "2026-10-05T09:00", end: "2026-10-05T11:00" }],
        equipmentRequirements: [{ type: "Projector", quantity: 2 }],
        registrationEnabled: true,
        registrationCapacity: 150,
        registrationOpensAt: "2024-05-01T09:00",
        registrationClosesAt: "2024-05-10T17:00",
      })
      .returning({ id: schema.eventRequests.id });

    await page.goto(`/events/${request.id}`);
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    // Read the record in the information section. The venue section repeats its fields.
    const record = page.getByRole("region", { name: "Event information" });
    await expect(fieldValue(record, "Purpose")).toHaveText("Quarterly town hall");
    await expect(fieldValue(record, "Description")).toHaveText("All-staff briefing with Q&A");
    await expect(fieldValue(record, "Type of event")).toHaveText("Town hall");
    await expect(fieldValue(record, "Expected attendance")).toHaveText("150");
    await expect(fieldValue(record, "Venue requirements")).toHaveText("Auditorium with stage");
    await expect(fieldValue(record, "Room-layout preference")).toHaveText("Theatre");
    await expect(fieldValue(record, "Accessibility requirements")).toHaveText(
      "Wheelchair-accessible seating"
    );
    await expect(fieldValue(record, "Special arrangements")).toHaveText("Live captioning");
    await expect(fieldValue(record, "Proposed dates and times")).toHaveText(
      "5 Oct 2026, 09:00 – 11:00"
    );
    await expect(fieldValue(record, "Equipment requirements")).toHaveText("Projector × 2");
    await expect(fieldValue(record, "Attendee registration")).toContainText("Capacity 150");
    await expect(fieldValue(record, "Attendee registration")).toContainText(
      "Opens 1 May 2024, 09:00, closes 10 May 2024, 17:00"
    );
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("takes an assigned request up for review", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Review Coordinator");
    ids.push(coordinator.id);
    const request = await seedAssignedRequest(ids, coordinator.id);

    await page.goto(`/events/${request.id}`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Take up for review" }).click();
    // Taking up the request reloads the event page and shows the decision section.
    await expect(page).toHaveURL(new RegExp(`/events/${request.id}$`));
    await expect(page.getByRole("button", { name: "Take up for review" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Record a decision" })).toBeVisible();

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored.status).toBe("under_review");
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("hides the take-up-for-review action once already under review", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Already Reviewing Coordinator");
    ids.push(coordinator.id);
    const request = await seedAssignedRequest(ids, coordinator.id, {
      eventName: `Already Reviewing ${randomUUID()}`,
      status: "under_review",
    });

    await page.goto(`/events/${request.id}`);
    await expect(page.getByRole("heading", { name: request.eventName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take up for review" })).toHaveCount(0);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("rejects an under-review request, records the decision and notifies the Organiser", async ({
  page,
  browser,
  baseURL,
}) => {
  const organiserContext = await browser.newContext({ baseURL });
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Decision Coordinator");
    ids.push(coordinator.id);
    const organiser = await register(organiserPage, "event_organiser", "Decision Organiser");
    ids.push(organiser.id);
    const eventName = `Decision ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName,
        status: "under_review",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
      })
      .returning();

    await page.goto(`/events/${request.id}`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a reason to reject this request");
    await page.getByLabel("Decision reason").fill("The requested venue is unavailable.");
    await page.getByRole("button", { name: "Reject request" }).click();
    // The decision reloads the event page and removes the review section.
    await expect(page).toHaveURL(new RegExp(`/events/${request.id}$`));
    await expect(page.getByRole("button", { name: "Reject request" })).toHaveCount(0);
    await expect(page.getByLabel("Status: Rejected")).toBeVisible();

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored).toMatchObject({
      status: "rejected",
      decisionReason: "The requested venue is unavailable.",
      decidedByCoordinatorId: coordinator.id,
      decidedByCoordinatorName: coordinator.name,
    });
    expect(stored.decidedAt).toBeInstanceOf(Date);

    await organiserPage.goto(`/events/${request.id}`);
    // Show the rejection in the Organiser's recorded decision and notification.
    await expect(organiserPage.getByLabel("Status: Rejected")).toBeVisible();
    const decision = organiserPage.getByRole("region", { name: "Recorded decision" });
    await expect(decision.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(decision.getByText("The requested venue is unavailable.")).toBeVisible();
    await expect(decision.getByText(coordinator.name)).toBeVisible();

    const notification = await waitForEmail(
      organiser.email,
      `Your event request for ${eventName} was rejected`
    );
    expect(notification).toContain(eventName);
    expect(notification).toContain("rejected");
    expect(notification).toContain("The requested venue is unavailable.");
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await organiserContext.close();
  }
});

test("does not list or expose another Coordinator's assigned request", async ({
  page,
  browser,
  baseURL,
}) => {
  const otherContext = await browser.newContext({ baseURL });
  const otherPage = await otherContext.newPage();
  const ids: string[] = [];
  try {
    const viewer = await register(page, "event_coordinator", "Excluded Viewer");
    ids.push(viewer.id);
    const owner = await register(otherPage, "event_coordinator", "Excluded Owner");
    ids.push(owner.id);
    const request = await seedAssignedRequest(ids, owner.id, {
      eventName: `Owned By Other ${randomUUID()}`,
    });

    await page.goto("/coordination");
    await expect(page.getByRole("link", { name: request.eventName })).toHaveCount(0);

    await page.goto(`/events/${request.id}`);
    // A request assigned to someone else is a 404, the same as a missing one.
    await expect(page.getByText(/not found/i)).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await otherContext.close();
  }
});
