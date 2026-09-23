// Browser actions share a page and must run in order.
// oxlint-disable node/no-process-env, no-await-in-loop
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
import { registerAccount } from "./register";

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

/**
 * Seeds a submitted request already assigned to `coordinatorId`. The organiser id is pushed onto
 * `ids` before the request insert, so a failed insert cannot leak it.
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

test("redirects unauthenticated visitors from the coordination detail", async ({ page }) => {
  await page.goto("/coordination/1");
  await expect(page).toHaveURL(/\/login/);
});

test("answers not found for a junk request id instead of the error boundary", async ({ page }) => {
  const coordinator = await register(page, "event_coordinator", "Junk Id Coordinator");
  try {
    await page.goto("/coordination/abc");
    await expect(page.getByText(/not found/i)).toBeVisible();
  } finally {
    await database.delete(schema.user).where(eq(schema.user.id, coordinator.id));
  }
});

test("hands over an event and transfers access", async ({ page, browser, baseURL }) => {
  const incomingContext = await browser.newContext({ baseURL });
  const organiserContext = await browser.newContext({ baseURL });
  const incomingPage = await incomingContext.newPage();
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const outgoing = await register(page, "event_coordinator", "Outgoing Coordinator");
    ids.push(outgoing.id);
    const incoming = await register(incomingPage, "event_coordinator", "Incoming Coordinator");
    ids.push(incoming.id);
    const organiser = await register(organiserPage, "event_organiser", "Handover Organiser");
    ids.push(organiser.id);
    const eventName = `Handover ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: outgoing.id,
        assignedAt: new Date(),
        purpose: "Coordinate a workshop",
        expectedAttendance: 25,
      })
      .returning();

    await organiserPage.goto(`/coordination/${request.id}`);
    await expect(organiserPage).toHaveURL(/\/dashboard$/);
    await page.goto("/coordination");
    await page.getByRole("link", { name: eventName }).click();
    await waitForHydration(page);
    await page.locator("#coordinatorId").click();
    await page.getByRole("option", { name: incoming.name }).click();
    await page.getByRole("button", { name: "Reassign Coordinator" }).click();
    await expect(page).toHaveURL(/\/coordination\/?$/);
    await expect(page.getByRole("link", { name: eventName })).toHaveCount(0);

    await page.goto(`/coordination/${request.id}`);
    await expect(
      page.getByText(
        "You no longer have coordination access to this request, or it is unavailable."
      )
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reassign Coordinator" })).toHaveCount(0);
    await incomingPage.goto(`/coordination/${request.id}`);
    await expect(incomingPage.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(incomingPage.getByRole("button", { name: "Reassign Coordinator" })).toBeVisible();

    await organiserPage.goto(`/event-requests/${request.id}`);
    await expect(organiserPage.getByRole("link", { name: incoming.email })).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await incomingContext.close();
    await organiserContext.close();
  }
});

test("picks up unassigned events for yourself or a named Coordinator", async ({
  page,
  browser,
  baseURL,
}) => {
  const otherContext = await browser.newContext({ baseURL });
  const otherPage = await otherContext.newPage();
  const ids: string[] = [];
  try {
    const actor = await register(page, "event_coordinator", "Pickup Coordinator");
    ids.push(actor.id);
    const other = await register(otherPage, "event_coordinator", "Named Coordinator");
    ids.push(other.id);
    // Use a unique organiser row so this test owns all its fixtures and cleanup cascades.
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Pickup Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    for (const target of [actor, other]) {
      const eventName = `Pickup ${randomUUID()}`;
      const [request] = await database
        .insert(schema.eventRequests)
        .values({ organiserId, eventName, status: "submitted", submittedAt: new Date() })
        .returning();
      await page.goto("/coordination");
      await page.getByRole("link", { name: eventName }).click();
      await waitForHydration(page);
      if (target.id === actor.id) {
        await page.getByRole("button", { name: "Assign to me" }).click();
      } else {
        await page.locator("#coordinatorId").click();
        await page.getByRole("option", { name: target.name }).click();
        await page.getByRole("button", { name: "Assign Coordinator", exact: true }).click();
      }
      await expect(page).toHaveURL(/\/coordination\/?$/);
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(stored.assignedCoordinatorId).toBe(target.id);
      const [audit] = await database
        .select()
        .from(schema.eventAssignments)
        .where(eq(schema.eventAssignments.eventRequestId, request.id));
      expect(audit.actorId).toBe(actor.id);
      expect(audit.fromCoordinatorId).toBeNull();
    }
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await otherContext.close();
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

function fieldValue(page: Page, term: string) {
  return page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd[1]");
}

test("shows every organiser-supplied field on an assigned request", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Detail Coordinator");
    ids.push(coordinator.id);
    const request = await seedAssignedRequest(ids, coordinator.id, {
      eventName: `Full Detail ${randomUUID()}`,
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
    });

    await page.goto(`/coordination/${request.id}`);
    await expect(page.getByRole("heading", { name: request.eventName })).toBeVisible();
    await expect(fieldValue(page, "Purpose")).toHaveText("Quarterly town hall");
    await expect(fieldValue(page, "Description")).toHaveText("All-staff briefing with Q&A");
    await expect(fieldValue(page, "Type of event")).toHaveText("Town hall");
    await expect(fieldValue(page, "Expected attendance")).toHaveText("150");
    await expect(fieldValue(page, "Venue requirements")).toHaveText("Auditorium with stage");
    await expect(fieldValue(page, "Room-layout preference")).toHaveText("Theatre");
    await expect(fieldValue(page, "Accessibility requirements")).toHaveText(
      "Wheelchair-accessible seating"
    );
    await expect(fieldValue(page, "Special arrangements")).toHaveText("Live captioning");
    await expect(fieldValue(page, "Proposed dates and times")).toHaveText(
      "5 Oct 2026, 09:00 – 11:00"
    );
    await expect(fieldValue(page, "Equipment requirements")).toHaveText("Projector × 2");
    await expect(fieldValue(page, "Attendee registration")).toContainText("Capacity 150");
    await expect(fieldValue(page, "Attendee registration")).toContainText(
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

    await page.goto(`/coordination/${request.id}`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Take up for review" }).click();
    await expect(page).toHaveURL(/\/coordination\/?$/);
    await expect(page.getByRole("link", { name: request.eventName })).toBeVisible();

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

    await page.goto(`/coordination/${request.id}`);
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

    await page.goto(`/coordination/${request.id}`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a reason to reject this request");
    await page.getByLabel("Decision reason").fill("The requested venue is unavailable.");
    await page.getByRole("button", { name: "Reject request" }).click();
    await expect(page).toHaveURL(/\/coordination\/?$/);

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

    await organiserPage.goto(`/event-requests/${request.id}`);
    await expect(organiserPage.getByRole("heading", { name: "Recorded decision" })).toBeVisible();
    await expect(fieldValue(organiserPage, "Decision")).toHaveText("Rejected");
    await expect(fieldValue(organiserPage, "Reason")).toHaveText(
      "The requested venue is unavailable."
    );
    await expect(fieldValue(organiserPage, "Decided by")).toHaveText(coordinator.name);
    const decidedAt = fieldValue(organiserPage, "Decided at").locator("time");
    await expect(decidedAt).toBeVisible();
    await expect(decidedAt).toHaveAttribute("datetime", stored.decidedAt?.toISOString() ?? "");

    const notification = await waitForEmail(organiser.email, "Your event request was rejected");
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

    await page.goto(`/coordination/${request.id}`);
    await expect(
      page.getByText(
        "You no longer have coordination access to this request, or it is unavailable."
      )
    ).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await otherContext.close();
  }
});
