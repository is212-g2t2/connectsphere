// oxlint-disable node/no-process-env
//
// PTR-53, PTR-54: the Organiser asks for a cancellation, the assigned Coordinator cancels or
// declines it, and a registered Attendee is told. Every test creates and
// removes its own event, so the tests run in parallel and never touch the shared demo rows.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_ID = "seed-coordinator-1";
const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_NAME = "Seeded Event Coordinator";
const ORGANISER_EMAIL = "jane.doe@example.com";
const ORGANISER_ID = "test-user-2";
const ATTENDEE_EMAIL = "demo@example.com";
const ATTENDEE_ID = "user-demo-1";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let venueId: number;
let venueName: string;
const created: number[] = [];

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  const [venue] = await database.select().from(schema.venues).limit(1);
  venueId = venue.id;
  venueName = venue.name;
});

test.afterEach(async () => {
  if (created.length > 0) {
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  }
});

test.afterAll(async () => {
  await pool?.end();
});

/** A confirmed event with registration on and an approved booking, assigned to the Coordinator. */
async function createEvent() {
  const name = `PTR-54 E2E ${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: ORGANISER_ID,
      status: "confirmed",
      submittedAt: new Date(),
      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),
      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seed Coordinator",
      decidedAt: new Date(),
      confirmedById: COORDINATOR_ID,
      confirmedByName: "Seed Coordinator",
      confirmedAt: new Date(),
      eventName: name,
      purpose: "test",
      proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
      expectedAttendance: 10,
      eventType: "Conference",
      registrationEnabled: true,
      registrationCapacity: 20,
      registrationOpensAt: "2020-01-01T00:00",
      registrationClosesAt: "2099-01-01T00:00",
    })
    .returning({ id: schema.eventRequests.id });
  created.push(row.id);

  // A random far-future day per event keeps parallel tests clear of the venue overlap constraint.
  const year = 2100 + Math.floor(Math.random() * 800);
  const day = 1 + Math.floor(Math.random() * 28);
  const date = `${year}-05-${String(day).padStart(2, "0")}`;
  await database.insert(schema.venueRequests).values({
    id: crypto.randomUUID(),
    eventId: row.id,
    venueId,
    requestedById: COORDINATOR_ID,
    startsAt: `${date} 09:00:00`,
    endsAt: `${date} 12:30:00`,
    status: "approved",
  });
  await database
    .insert(schema.eventRegistrations)
    .values({ eventId: row.id, attendeeId: ATTENDEE_ID });
  return { id: row.id, name };
}

const statusOf = async (id: number) =>
  (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0]
    .status;

async function openAs(browser: Browser, email: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithSeedPassword(page, email);
  await page.goto(path);
  await waitForHydration(page);
  return page;
}

async function requestCancellation(browser: Browser, id: number) {
  const organiser = await openAs(browser, ORGANISER_EMAIL, `/events/${id}`);
  await organiser.getByRole("button", { name: "Request cancellation" }).click();
  await organiser.getByRole("button", { name: "Send request" }).click();
  await expect(
    organiser.getByText(`Cancellation requested. ${COORDINATOR_NAME} has been notified.`)
  ).toBeVisible();
  return organiser;
}

test("the Organiser requests cancellation, and the event's status waits (PTR-53)", async ({
  browser,
}) => {
  const { id, name } = await createEvent();

  const organiser = await requestCancellation(browser, id);

  const history = organiser.getByRole("region", { name: "Cancellation requests" });
  await expect(
    history.getByText(
      `Waiting. The event's status stays the same until ${COORDINATOR_NAME} processes the request.`
    )
  ).toBeVisible();
  await expect(organiser.getByRole("button", { name: "Request cancellation" })).toHaveCount(0);
  expect(await statusOf(id)).toBe("confirmed");
  await organiser.context().close();

  // AC3: the assigned Coordinator gets the request by email as well as in the inbox.
  const body = await waitForEmail(COORDINATOR_EMAIL, `Event cancellation requested: ${name}`);
  expect(body).toContain(name);
});

test("the Coordinator cancels the event, sees what is still held, and the Attendee is told (PTR-54)", async ({
  browser,
}) => {
  const { id, name } = await createEvent();
  await (await requestCancellation(browser, id)).context().close();

  const coordinator = await openAs(browser, COORDINATOR_EMAIL, `/events/${id}`);
  await coordinator.getByRole("button", { name: "Cancel event" }).click();
  await coordinator.getByRole("button", { name: "Cancel the event" }).click();
  await expect(
    coordinator.getByText("Event cancelled. Everyone concerned will be notified.")
  ).toBeVisible();
  const releases = coordinator.getByRole("region", { name: "Outstanding releases" });
  await expect(releases.getByText(new RegExp(`Venue booking: ${venueName}`))).toBeVisible();
  expect(await statusOf(id)).toBe("cancelled");
  await coordinator.context().close();

  const attendee = await openAs(browser, ATTENDEE_EMAIL, "/notifications");
  await expect(attendee.getByText(`Event cancelled: ${name}`)).toBeVisible();
  await attendee.context().close();
});

test("the Coordinator declines with a reason, and the Organiser sees it (PTR-54 AC8)", async ({
  browser,
}) => {
  const { id } = await createEvent();
  await (await requestCancellation(browser, id)).context().close();

  const coordinator = await openAs(browser, COORDINATOR_EMAIL, `/events/${id}`);
  await coordinator.getByLabel("Reason for declining").fill("The venue deposit is paid.");
  await coordinator.getByRole("button", { name: "Decline request" }).click();
  await expect(coordinator.getByText("Cancellation request declined.")).toBeVisible();
  await coordinator.context().close();

  const organiser = await openAs(browser, ORGANISER_EMAIL, `/events/${id}`);
  const history = organiser.getByRole("region", { name: "Cancellation requests" });
  await expect(history.getByText(/Declined by/)).toBeVisible();
  await expect(history.getByText("The venue deposit is paid.")).toBeVisible();
  expect(await statusOf(id)).toBe("confirmed");
  await organiser.context().close();
});
