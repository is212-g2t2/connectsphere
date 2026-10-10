// oxlint-disable node/no-process-env
//
// PTR-42: Technical Support reduces or releases a reservation from the event page lines section.
// Every test creates its own type, venue, booking and event through its own pool and removes
// them again, so it never touches the shared demo rows.
import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";

const COORDINATOR_ID = "seed-coordinator-1";
const TECH_SUPPORT_ID = "seed-tech-support-1";

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

/** An approved, equipment-submitted event on 1 Feb 2030 holding `reserved` of `requested` units. */
async function createReservedEvent(requested: number, reserved: number) {
  const [type] = await database
    .insert(schema.equipmentTypes)
    .values({ name: `E2E release ${crypto.randomUUID().slice(0, 8)}`, quantityHeld: 6 })
    .returning();
  typeIds.push(type.id);

  const [event] = await database
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
      eventName: `PTR-42 E2E ${crypto.randomUUID().slice(0, 8)}`,
      purpose: "test",
      proposedDates: [{ start: "2030-02-01T09:00", end: "2030-02-01T17:00" }],
      registrationOpensAt: "2030-01-01T09:00",
      registrationClosesAt: "2030-01-31T17:00",
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
  eventIds.push(event.id);

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
    eventId: event.id,
    venueId: venue.id,
    startsAt: "2030-02-01T10:00:00",
    endsAt: "2030-02-01T12:00:00",
    status: "approved",
    requestedById: COORDINATOR_ID,
  });

  const lineId = crypto.randomUUID();
  // The seeded Technical Support member signed in below is the one holding the line.
  await database.insert(schema.equipmentRequests).values({
    id: lineId,
    eventId: event.id,
    equipmentTypeId: type.id,
    item: type.name,
    quantity: requested,
    assignedStaffId: TECH_SUPPORT_ID,
    arrangementStatus: reserved >= requested ? "reserved" : "requested",
  });
  await database.insert(schema.equipmentReservations).values({
    id: `eq-res-${crypto.randomUUID()}`,
    equipmentRequestId: lineId,
    equipmentTypeId: type.id,
    quantity: reserved,
    startsAt: "2030-02-01T10:00:00",
    endsAt: "2030-02-01T12:00:00",
  });
  return { id: event.id, name: event.name, item: type.name, lineId };
}

test("[PTR-42][AC1][AC4] reducing then releasing returns the line to Requested and leaves the event approved", async ({
  page,
}) => {
  const target = await createReservedEvent(3, 3);

  await signInAsStaff(page, "technical_support_staff");
  await page.goto(`/events/${target.id}`);
  await waitForHydration(page);

  const line = page.getByRole("listitem", { name: target.item });
  await expect(line.getByText("· 3 reserved")).toBeVisible();

  // Reduce to one.
  await line
    .getByRole("button", { name: `Reduce or release equipment for ${target.item}` })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Currently reserved:")).toBeVisible();
  await dialog.getByLabel("Units to keep reserved").fill("1");
  await dialog.getByRole("button", { name: "Keep 1 unit, release 2" }).click();
  await expect(dialog).toBeHidden();
  await expect(line.getByText("· 1 reserved")).toBeVisible();
  await expect(
    line.getByText(/Last release: 2 units given back by Seeded Technical Support on/)
  ).toBeVisible();

  // Release the rest: the reopened dialog shows the fresh holding.
  await line
    .getByRole("button", { name: `Reduce or release equipment for ${target.item}` })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Currently reserved:").locator("xpath=..")).toContainText("1");
  await expect(dialog.getByLabel("Units to keep reserved")).toHaveValue("0");
  await dialog.getByRole("button", { name: "Release all 1 unit" }).click();
  // While the dialog is open the list is aria-hidden, so wait for it to close before reading.
  await expect(dialog).toBeHidden();
  await expect(line).toBeVisible();
  await expect(line.getByText("· 1 reserved")).toHaveCount(0);
  await expect(
    line.getByText(/Last release: 1 unit given back by Seeded Technical Support on/)
  ).toBeVisible();
  await expect(
    line.getByRole("button", { name: `Reduce or release equipment for ${target.item}` })
  ).toHaveCount(0);

  const [event] = await database
    .select({ status: schema.eventRequests.status })
    .from(schema.eventRequests)
    .where(eq(schema.eventRequests.id, target.id));
  expect(event.status).toBe("approved");
  const [row] = await database
    .select({ arrangementStatus: schema.equipmentRequests.arrangementStatus })
    .from(schema.equipmentRequests)
    .where(eq(schema.equipmentRequests.id, target.lineId));
  expect(row.arrangementStatus).toBe("requested");
});

test("[PTR-42][AC1] releasing with a reason marks the line Unavailable and shows the reason", async ({
  page,
}) => {
  const target = await createReservedEvent(2, 2);

  await signInAsStaff(page, "technical_support_staff");
  await page.goto(`/events/${target.id}`);
  await waitForHydration(page);

  const line = page.getByRole("listitem", { name: target.item });
  await line
    .getByRole("button", { name: `Reduce or release equipment for ${target.item}` })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason the line is unavailable (optional)")
    .fill("Both units failed the safety check");
  await dialog.getByRole("button", { name: "Release all 2 units" }).click();

  await expect(dialog).toBeHidden();
  await expect(line).toBeVisible();
  await expect(line.getByText("· 2 reserved")).toHaveCount(0);
  await expect(
    line.getByRole("combobox", { name: `Arrangement state for ${target.item}` })
  ).toContainText("Unavailable");
  const [row] = await database
    .select({
      arrangementStatus: schema.equipmentRequests.arrangementStatus,
      unavailableReason: schema.equipmentRequests.unavailableReason,
    })
    .from(schema.equipmentRequests)
    .where(eq(schema.equipmentRequests.id, target.lineId));
  expect(row).toEqual({
    arrangementStatus: "unavailable",
    unavailableReason: "Both units failed the safety check",
  });
});
