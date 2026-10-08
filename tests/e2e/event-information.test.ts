// oxlint-disable node/no-process-env
//
// PTR-22: the assigned Coordinator updates an approved event's information from the event page,
// the change log records it, and the Organiser sees only the new value. PTR-23: a change to a
// significant field is warned about first, naming what the event holds, and the staff holding a
// booking are told. Every test creates and removes its own event, so the tests can run in parallel
// and never touch the demo rows.
import { expect, test } from "@playwright/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
const ORGANISER_EMAIL = "jane.doe@example.com";
const ORGANISER_ID = "test-user-2";
const VENUE_STAFF_ID = "seed-venue-staff-1";

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

/** An approved event assigned to the seeded Coordinator and owned by the seeded Organiser. */
async function createApprovedEvent() {
  const name = `PTR-22 E2E ${crypto.randomUUID().slice(0, 8)}`;
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
  return { id: row.id, name };
}

test("the assigned Coordinator updates an approved event, and the change is recorded (AC2, AC4)", async ({
  page,
}) => {
  const { id, name } = await createApprovedEvent();
  const renamed = `${name} (renamed)`;

  await signInWithSeedPassword(page, COORDINATOR_EMAIL);
  await page.goto(`/events/${id}`);
  await waitForHydration(page);

  await page.getByRole("button", { name: "Edit event information" }).click();
  await page.getByLabel("Event name (required)").fill(renamed);
  await page.getByLabel("Expected attendance (required)").fill("65");
  await page.getByRole("button", { name: "Save changes" }).click();

  // PTR-23: the attendance is significant, so the warning comes first; the event holds nothing.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("This is a significant change")).toBeVisible();
  await expect(
    dialog.getByText("This event holds no venue booking, tentative hold or equipment reservation.")
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Save anyway" }).click();

  await expect(page.getByText("Event information saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  const log = await database
    .select()
    .from(schema.eventInformationChanges)
    .where(eq(schema.eventInformationChanges.eventRequestId, id))
    .orderBy(asc(schema.eventInformationChanges.id));
  expect(
    log.map(({ field, amendment, changedById }) => ({ field, amendment, changedById }))
  ).toEqual([
    { field: "eventName", amendment: { from: name, to: renamed }, changedById: COORDINATOR_ID },
    { field: "expectedAttendance", amendment: { from: 40, to: 65 }, changedById: COORDINATOR_ID },
  ]);
});

test("the Organiser never sees the previous value on a return visit (AC3)", async ({ page }) => {
  const { id, name } = await createApprovedEvent();
  const renamed = `${name} (renamed)`;

  await signInWithSeedPassword(page, ORGANISER_EMAIL);
  await page.goto(`/events/${id}`);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The router holds the event page's data. Leave it, then let the update land and reload, so
  // the dashboard re-reads the list instead of showing its cached copy.
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await database
    .update(schema.eventRequests)
    .set({ eventName: renamed })
    .where(eq(schema.eventRequests.id, id));
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByRole("link", { name: renamed, exact: true })).toBeVisible();

  // Record every page heading from here on, so a cached copy shown for one frame still counts.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenHeadings: seen });
    new MutationObserver(() => {
      const heading = document.querySelector("h1")?.textContent;
      if (heading) seen.push(heading);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole("link", { name: renamed, exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  const seen = await page.evaluate(
    () => (window as unknown as { seenHeadings: string[] }).seenHeadings
  );
  expect(seen).not.toContain(name);
});

test("an ordinary edit saves with no warning (PTR-23 AC4)", async ({ page }) => {
  const { id } = await createApprovedEvent();

  await signInWithSeedPassword(page, COORDINATOR_EMAIL);
  await page.goto(`/events/${id}`);
  await waitForHydration(page);

  await page.getByRole("button", { name: "Edit event information" }).click();
  await page.getByLabel("Purpose (required)").fill("Plan the forum and the dinner");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Event information saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("a significant change names the booking the event holds, leaves it as it is, and tells the Venue Staff (PTR-23 AC2, AC3, AC5)", async ({
  page,
}) => {
  const { id } = await createApprovedEvent();
  const venueName = `PTR-23 Hall ${crypto.randomUUID().slice(0, 8)}`;
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name: venueName,
      location: "PTR-23 Wing",
      maxCapacity: 200,
      operatingHours: DEFAULT_OPERATING_HOURS,
    })
    .returning({ id: schema.venues.id });
  const bookingId = crypto.randomUUID();
  await database.insert(schema.venueRequests).values({
    id: bookingId,
    eventId: id,
    venueId: venue.id,
    requestedById: COORDINATOR_ID,
    assignedStaffId: VENUE_STAFF_ID,
    startsAt: "2030-01-01 09:00:00",
    endsAt: "2030-01-01 17:00:00",
    status: "approved",
  });

  try {
    await signInWithSeedPassword(page, COORDINATOR_EMAIL);
    await page.goto(`/events/${id}`);
    await waitForHydration(page);

    await page.getByRole("button", { name: "Edit event information" }).click();
    await page.getByLabel("Proposed end 1 (required)").fill("2030-01-01T18:00");
    await page.getByRole("button", { name: "Save changes" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("This is a significant change")).toBeVisible();
    await expect(
      dialog.getByText(`Venue booking: ${venueName}, 1 Jan 2030, 09:00 – 17:00`)
    ).toBeVisible();
    await expect(dialog.getByText(/will be told what changed/)).toBeVisible();

    // Going back keeps the edit and sends nothing.
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByLabel("Proposed end 1 (required)")).toHaveValue("2030-01-01T18:00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Save anyway" }).click();

    await expect(
      page.getByText(
        "Event information saved. The staff holding its arrangements have been notified."
      )
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    const [booking] = await database
      .select({ status: schema.venueRequests.status, endsAt: schema.venueRequests.endsAt })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, bookingId));
    expect(booking).toEqual({ status: "approved", endsAt: "2030-01-01 17:00:00" });
    const notices = await database
      .select({
        recipientId: schema.notifications.recipientId,
        payload: schema.notifications.payload,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, id),
          eq(schema.notifications.kind, "event_significant_change")
        )
      );
    expect(notices).toEqual([
      {
        recipientId: VENUE_STAFF_ID,
        payload: expect.objectContaining({
          audience: "venue_staff",
          venueName,
          changedFields: ["proposedDates"],
        }),
      },
    ]);
  } finally {
    await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, id));
    created.length = 0;
    await database.delete(schema.venues).where(eq(schema.venues.id, venue.id));
  }
});
