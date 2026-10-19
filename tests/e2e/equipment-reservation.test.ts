// oxlint-disable node/no-process-env
//
// PTR-41: Technical Support reserves equipment from the event page lines section. Each test
// creates its own type, venue, booking, and event through its own pool and removes them again.
// It touches no shared demo row. Tests run in parallel.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";

const COORDINATOR_ID = "seed-coordinator-1";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
const eventIds: number[] = [];
const venueIds: number[] = [];
const typeIds: number[] = [];

test.beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterAll(async () => {
  await pool?.end();
});

test.afterEach(async () => {
  // Events cascade to bookings, lines, and reservations. Reservations restrict their type.
  if (eventIds.length > 0) {
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
  }
  if (typeIds.length > 0) {
    await database.delete(schema.equipmentTypes).where(inArray(schema.equipmentTypes.id, typeIds));
  }
  if (venueIds.length > 0) {
    await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
  }
  eventIds.length = venueIds.length = typeIds.length = 0;
});

async function createType(quantityHeld: number) {
  const [row] = await database
    .insert(schema.equipmentTypes)
    .values({ name: `E2E equipment ${crypto.randomUUID().slice(0, 8)}`, quantityHeld })
    .returning();
  typeIds.push(row.id);
  return row;
}

/** Approve an event on 1 Jan 2030 with equipment submitted. Request one line. */
async function createEvent(typeName: string, typeId: number, quantity: number) {
  const [row] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: "test-user-2",
      status: "approved",
      submittedAt: new Date(),
      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),
      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seed Coordinator",
      decidedAt: new Date(),
      equipmentSubmittedAt: new Date(),
      eventName: `PTR-41 E2E ${crypto.randomUUID().slice(0, 8)}`,
      purpose: "test",
      proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
      registrationOpensAt: "2029-12-01T09:00",
      registrationClosesAt: "2029-12-31T17:00",
      expectedAttendance: 10,
      venueRequirements: "",
      roomLayoutPreference: "",
      accessibilityRequirements: "",
      description: "",
      eventType: "Conference",
      equipmentRequirements: [],
      specialArrangements: "",
      registrationEnabled: true,
      registrationCapacity: 10,
    })
    .returning({ id: schema.eventRequests.id, name: schema.eventRequests.eventName });
  eventIds.push(row.id);

  await database.insert(schema.equipmentRequests).values({
    id: crypto.randomUUID(),
    eventId: row.id,
    equipmentTypeId: typeId,
    item: typeName,
    quantity,
  });
  return { id: row.id, name: row.name, item: typeName };
}

/** Approve a booking of `eventId` on its own venue, so that no two bookings overlap. */
async function addBooking(eventId: number, [start, end]: [string, string]) {
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name: `E2E venue ${crypto.randomUUID()}`,
      location: "Test",
      maxCapacity: 100,
      operatingHours: DEFAULT_OPERATING_HOURS,
    })
    .returning({ id: schema.venues.id });
  venueIds.push(venue.id);
  const bookingId = crypto.randomUUID();
  await database.insert(schema.venueRequests).values({
    id: bookingId,
    eventId,
    venueId: venue.id,
    startsAt: `2030-01-01T${start}:00`,
    endsAt: `2030-01-01T${end}:00`,
    status: "approved",
    requestedById: COORDINATOR_ID,
  });
  return { id: bookingId, venueId: venue.id };
}

async function openEventPage(page: Page, eventId: number) {
  await signInAsStaff(page, "technical_support_staff");
  await page.goto(`/events/${eventId}`);
  await waitForHydration(page);
}

const lineFor = (page: Page, item: string) => page.getByRole("listitem", { name: item });

async function openAndReserve(page: Page, eventId: number, item: string, quantity: string) {
  await openEventPage(page, eventId);
  const line = lineFor(page, item);
  await line.getByRole("button", { name: `Reserve equipment for ${item}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/available for/)).toBeVisible();
  await dialog.getByLabel("Total units to reserve").fill(quantity);
  await dialog.getByRole("button", { name: "Confirm reservation" }).click();
  return { line, dialog };
}

test("reserving the full quantity marks the line reserved and shows the count", async ({
  page,
}) => {
  const type = await createType(5);
  const target = await createEvent(type.name, type.id, 2);
  await addBooking(target.id, ["10:00", "12:00"]);

  const { line, dialog } = await openAndReserve(page, target.id, target.item, "2");

  await expect(dialog).not.toBeVisible();
  await expect(line.getByText("2 reserved")).toBeVisible();

  await page.reload();
  await waitForHydration(page);
  await expect(lineFor(page, target.item).getByText("2 reserved")).toBeVisible();
});

test("the reserved line locks its arrangement state", async ({ page }) => {
  const type = await createType(5);
  const target = await createEvent(type.name, type.id, 2);
  await addBooking(target.id, ["10:00", "12:00"]);

  const { line } = await openAndReserve(page, target.id, target.item, "2");

  await expect(line.getByText("2 reserved")).toBeVisible();
  await expect(line.getByLabel(`Arrangement state for ${target.item}`)).toBeDisabled();
});

test("refuses a request exceeding what is available, naming the shortfall", async ({ page }) => {
  const type = await createType(1);
  const target = await createEvent(type.name, type.id, 2);
  await addBooking(target.id, ["10:00", "12:00"]);

  const { dialog, line } = await openAndReserve(page, target.id, target.item, "2");

  await expect(dialog.getByRole("alert")).toContainText("shortfall of 1");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(line.getByLabel(`Arrangement state for ${target.item}`)).toContainText("Requested");
});

test("chooses a session, snapshots its buffers, and shows Window changed after release", async ({
  page,
  browser,
}) => {
  const type = await createType(5);
  const target = await createEvent(type.name, type.id, 2);
  await addBooking(target.id, ["10:00", "12:00"]);
  const afternoon = await addBooking(target.id, ["15:00", "17:00"]);
  await database.insert(schema.venueOccupancy).values({
    venueRequestId: afternoon.id,
    eventId: target.id,
    venueId: afternoon.venueId,
    startsAt: "2030-01-01 15:00:00",
    endsAt: "2030-01-01 17:00:00",
    setupMinutes: 30,
    turnaroundMinutes: 45,
  });
  await openEventPage(page, target.id);
  const line = lineFor(page, target.item);
  await line.getByRole("button", { name: `Reserve equipment for ${target.item}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirm reservation" })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Session venue booking" }).click();
  await page.getByRole("option", { name: /14:30/ }).click();
  await expect(dialog.getByText(/5 units available for/)).toContainText("17:45");
  await dialog.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(line.getByText("2 reserved")).toBeVisible();
  const [reservation] = await database
    .select()
    .from(schema.equipmentReservations)
    .innerJoin(
      schema.equipmentRequests,
      eq(schema.equipmentRequests.id, schema.equipmentReservations.equipmentRequestId)
    )
    .where(eq(schema.equipmentRequests.eventId, target.id));
  expect(reservation.equipment_reservations).toMatchObject({
    venueRequestId: afternoon.id,
    startsAt: "2030-01-01 14:30:00",
    endsAt: "2030-01-01 17:45:00",
  });
  await expect(line.getByText("Window changed")).toHaveCount(0);
  await database
    .update(schema.venueRequests)
    .set({ status: "released", releaseReason: "Test" })
    .where(eq(schema.venueRequests.id, afternoon.id));
  await page.reload();
  await expect(lineFor(page, target.item).getByText("Window changed")).toBeVisible();
  const coordinatorContext = await browser.newContext();
  try {
    const coordinator = await coordinatorContext.newPage();
    await signInAsStaff(coordinator, "event_coordinator");
    await coordinator.goto(`/events/${target.id}`);
    await expect(coordinator.getByText("Window changed", { exact: true })).toBeVisible();
  } finally {
    await coordinatorContext.close();
  }
});
