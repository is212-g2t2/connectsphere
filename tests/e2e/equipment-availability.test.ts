// oxlint-disable node/no-process-env
//
// PTR-40: the availability check on the Technical Support equipment review page. Every test
// creates its own type, venue, booking and event through its own pool and removes them again, so
// it never touches the shared demo rows and can run in parallel.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
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
  // Events cascade to bookings, lines and reservations; reservations restrict their type.
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

/** An approved event on 1 Jan 2030 with one submitted line, ready for a booking. */
async function createEvent() {
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
      eventName: `PTR-40 E2E ${crypto.randomUUID().slice(0, 8)}`,
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
    .returning({ id: schema.eventRequests.id });
  eventIds.push(row.id);

  const [line] = await database
    .insert(schema.equipmentRequests)
    .values({ id: crypto.randomUUID(), eventId: row.id, item: "Projector", quantity: 2 })
    .returning({ id: schema.equipmentRequests.id });
  return { id: row.id, lineId: line.id };
}

/** An approved booking of `eventId` on its own venue (the overlap constraint is per venue). */
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
  await database.insert(schema.venueRequests).values({
    id: crypto.randomUUID(),
    eventId,
    venueId: venue.id,
    startsAt: `2030-01-01T${start}:00`,
    endsAt: `2030-01-01T${end}:00`,
    status: "approved",
    requestedById: COORDINATOR_ID,
  });
}

async function openRequest(page: Page, eventId: number) {
  await signInAsStaff(page, "technical_support_staff");
  await page.goto(`/equipment-requests/${eventId}`);
  await waitForHydration(page);
}

async function check(page: Page, typeName: string, quantity?: string) {
  await page.getByRole("combobox", { name: "Equipment type" }).click();
  await page.getByRole("option", { name: typeName }).click();
  if (quantity) {
    await page.getByRole("spinbutton", { name: "Quantity (optional)" }).fill(quantity);
  }
  await page.getByRole("button", { name: "Check availability" }).click();
}

test("states the shortfall for the event's approved booking period", async ({ page }) => {
  const type = await createType(10);
  await database
    .insert(schema.equipmentUnavailability)
    .values({ equipmentTypeId: type.id, quantityUnavailable: 2, reason: "Damaged" });
  const target = await createEvent();
  await addBooking(target.id, ["10:00", "12:00"]);
  const other = await createEvent();
  await addBooking(other.id, ["11:00", "13:00"]);
  await database.insert(schema.equipmentReservations).values({
    id: crypto.randomUUID(),
    equipmentRequestId: other.lineId,
    equipmentTypeId: type.id,
    quantity: 3,
  });

  await openRequest(page, target.id);
  await expect(page.getByText("Choose an equipment type")).toBeVisible();

  await check(page, type.name, "8");

  await expect(page.getByRole("status")).toHaveText(
    `${type.name}: Short by 3: 5 available, 8 requested (1 Jan 2030, 10:00 to 1 Jan 2030, 12:00)`
  );
});

test("states what is available when no quantity is asked", async ({ page }) => {
  const type = await createType(4);
  const target = await createEvent();
  await addBooking(target.id, ["10:00", "12:00"]);

  await openRequest(page, target.id);
  await check(page, type.name);

  const outcome = page.getByRole("status");
  await expect(outcome).toContainText("4 available");
  await expect(outcome).not.toContainText("Short by");
});

test("refuses an event with no approved venue booking", async ({ page }) => {
  const type = await createType(4);
  const target = await createEvent();

  await openRequest(page, target.id);
  await check(page, type.name);

  await expect(page.getByText("The event has no approved venue booking yet")).toBeVisible();
});
