// oxlint-disable node/no-process-env
//
// PTR-52: the Organiser's change request is applied by the assigned Coordinator through the event
// information form, or declined with a reason, and the Organiser sees the outcome on their request.
// Every test creates and removes its own event, so the tests run in parallel and never touch the
// shared demo rows.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_ID = "seed-coordinator-1";
const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const ORGANISER_EMAIL = "jane.doe@example.com";
const ORGANISER_ID = "test-user-2";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
const created: number[] = [];

test.beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterEach(async () => {
  if (created.length > 0) {
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  }
});

test.afterAll(async () => {
  await pool?.end();
});

/** An approved event assigned to the seeded Coordinator, with one waiting change request. */
async function createEventWithRequest(whatShouldChange: string, requestedValue: string) {
  const name = `PTR-52 E2E ${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: ORGANISER_ID,
      status: "approved",
      submittedAt: new Date(),
      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),
      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seed Coordinator",
      decidedAt: new Date(),
      eventName: name,
      purpose: "Plan the forum",
      proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
      expectedAttendance: 40,
      eventType: "Conference",
    })
    .returning({ id: schema.eventRequests.id });
  created.push(row.id);
  const [request] = await database
    .insert(schema.eventChangeRequests)
    .values({ eventRequestId: row.id, organiserId: ORGANISER_ID, whatShouldChange, requestedValue })
    .returning({ id: schema.eventChangeRequests.id });
  return { id: row.id, name, requestId: request.id };
}

async function openAs(browser: Browser, email: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithSeedPassword(page, email);
  await page.goto(path);
  await waitForHydration(page);
  return page;
}

const outcomeOf = async (requestId: number) =>
  (
    await database
      .select({
        outcome: schema.eventChangeRequests.outcome,
        declineReason: schema.eventChangeRequests.declineReason,
      })
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.id, requestId))
  )[0];

const organiserNotices = (eventId: number) =>
  database
    .select({
      recipientId: schema.notifications.recipientId,
      payload: schema.notifications.payload,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.eventRequestId, eventId),
        eq(schema.notifications.kind, "event_change_processed")
      )
    );

test("the Coordinator applies a change request through the event information form, and the Organiser sees it applied (AC1, AC2, AC5)", async ({
  browser,
}) => {
  const { id, name, requestId } = await createEventWithRequest("Event name", "Add Dinner");

  const coordinator = await openAs(browser, COORDINATOR_EMAIL, "/coordination");
  // Scoped to this event's row: a sibling test may leave another waiting request on the list.
  await expect(
    coordinator
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByText("1 change request waiting")
  ).toBeVisible();
  await coordinator.getByRole("link", { name }).click();
  await waitForHydration(coordinator);

  await coordinator.getByRole("button", { name: "Apply change request #1" }).click();
  await expect(
    coordinator.getByRole("heading", { name: "Applying the Organiser's change request" })
  ).toBeVisible();
  await coordinator.getByLabel("Event name (required)").fill(`${name} Dinner`);
  await coordinator.getByRole("button", { name: "Save and mark applied" }).click();

  await expect(
    coordinator.getByText("Change request applied. The Organiser will be notified.")
  ).toBeVisible();
  await expect(
    coordinator.getByRole("heading", { level: 1, name: `${name} Dinner` })
  ).toBeVisible();
  await expect(
    coordinator.getByRole("region", { name: "Change requests awaiting your decision" })
  ).toHaveCount(0);
  await expect(coordinator.getByText(/Applied by Seeded Event Coordinator on/)).toBeVisible();
  expect(await outcomeOf(requestId)).toEqual({ outcome: "applied", declineReason: null });
  expect(await organiserNotices(id)).toEqual([
    {
      recipientId: ORGANISER_ID,
      payload: { outcome: "applied", eventName: `${name} Dinner`, whatShouldChange: "Event name" },
    },
  ]);

  const organiser = await openAs(browser, ORGANISER_EMAIL, `/events/${id}`);
  await expect(organiser.getByRole("heading", { level: 1, name: `${name} Dinner` })).toBeVisible();
  await expect(organiser.getByText(/Applied by Seeded Event Coordinator on/)).toBeVisible();
});

test("the Coordinator declines a change request with a reason, and the Organiser sees why (AC2, AC5)", async ({
  browser,
}) => {
  const { id, name, requestId } = await createEventWithRequest(
    "Expected attendance",
    "400 attendees"
  );

  const coordinator = await openAs(browser, COORDINATOR_EMAIL, `/events/${id}`);
  await coordinator.getByRole("button", { name: "Decline change request #1" }).click();
  await coordinator.getByRole("button", { name: "Decline request #1 with this reason" }).click();
  await expect(coordinator.getByText("Enter a reason for declining")).toBeVisible();
  await coordinator.getByLabel("Reason for declining").fill("The hall holds 80 at most.");
  await coordinator.getByRole("button", { name: "Decline request #1 with this reason" }).click();

  await expect(
    coordinator.getByText("Change request declined. The Organiser will be notified.")
  ).toBeVisible();
  await expect(coordinator.getByText(/Declined by Seeded Event Coordinator on/)).toBeVisible();
  expect(await outcomeOf(requestId)).toEqual({
    outcome: "declined",
    declineReason: "The hall holds 80 at most.",
  });

  const organiser = await openAs(browser, ORGANISER_EMAIL, `/events/${id}`);
  await expect(organiser.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(organiser.getByText(/Declined by Seeded Event Coordinator on/)).toBeVisible();
  await expect(organiser.getByText("The hall holds 80 at most.")).toBeVisible();
});
