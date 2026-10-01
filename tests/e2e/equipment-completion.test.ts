// oxlint-disable node/no-process-env
//
// PTR-43: Equipment arrangement completion and unavailable handling (Playwright E2E).
//
// Uses the same real E2E setup as the working equipment reservation test:
// - Drizzle + pg for test data
// - signInAsStaff() for authentication
// - waitForHydration() after navigation
// - /equipment-requests/:id for Technical Support
//
// Email delivery is covered by the PTR-43 integration test, which mocks sendEmail directly.
// This E2E file focuses on the actual user-facing behaviour.

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
const ORGANISER_ID = "test-user-2";
const TECHNICAL_SUPPORT_ID = "seed-tech-support-1";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

const eventIds: number[] = [];
const venueIds: number[] = [];
const typeIds: number[] = [];

const REASON_REQUIRED = "Give a reason for marking this line unavailable";

const RESERVED_REFUSAL = "This line holds a reservation and its state cannot be changed.";

const equipmentUrl = (id: number) => `/equipment-requests/${id}`;

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

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

  eventIds.length = 0;
  venueIds.length = 0;
  typeIds.length = 0;
});

/* -------------------------------------------------------------------------- */
/* Test data helpers                                                          */
/* -------------------------------------------------------------------------- */

async function createType(quantityHeld = 10) {
  const [row] = await database
    .insert(schema.equipmentTypes)
    .values({
      name: `PTR-43 equipment ${crypto.randomUUID().slice(0, 8)}`,
      quantityHeld,
    })
    .returning();

  typeIds.push(row.id);

  return row;
}

type LineState = "requested" | "reserved" | "not_required" | "unavailable";

interface LineOptions {
  item: string;
  quantity?: number;
  state: LineState;
  assignedStaffId?: string;
  unavailableReason?: string;
  equipmentTypeId: number;
}

async function createEvent(lines: LineOptions[]) {
  const [event] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: ORGANISER_ID,

      status: "planning",

      submittedAt: new Date(),

      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),

      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seed Coordinator",
      decidedAt: new Date(),

      equipmentSubmittedAt: new Date(),

      eventName: `PTR-43 E2E ${crypto.randomUUID().slice(0, 8)}`,
      purpose: "PTR-43 E2E test",

      proposedDates: [
        {
          start: "2030-01-01T09:00",
          end: "2030-01-01T17:00",
        },
      ],

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
    .returning({
      id: schema.eventRequests.id,
      name: schema.eventRequests.eventName,
    });

  eventIds.push(event.id);

  const lineIds: string[] = [];

  const equipmentRows = lines.map(line => {
    const id = crypto.randomUUID();

    lineIds.push(id);

    return {
      id,
      eventId: event.id,
      equipmentTypeId: line.equipmentTypeId,
      item: line.item,
      quantity: line.quantity ?? 1,
      arrangementStatus: line.state,
      assignedStaffId: line.assignedStaffId ?? null,
      unavailableReason: line.unavailableReason ?? null,
    };
  });

  await database.insert(schema.equipmentRequests).values(equipmentRows);

  return {
    id: event.id,
    name: event.name,
    lineIds,
  };
}

async function addBooking(eventId: number, [start, end]: [string, string]) {
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name: `PTR-43 venue ${crypto.randomUUID().slice(0, 8)}`,
      location: "Test",
      maxCapacity: 100,
      operatingHours: DEFAULT_OPERATING_HOURS,
    })
    .returning({
      id: schema.venues.id,
    });

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

async function openEquipmentPage(page: Page, eventId: number) {
  await signInAsStaff(page, "technical_support_staff");
  await page.goto(equipmentUrl(eventId));
  await waitForHydration(page);
}

async function chooseArrangementState(page: Page, item: string, state: string) {
  const line = page.getByRole("listitem", {
    name: new RegExp(item),
  });

  await line.getByLabel(`Arrangement state for ${item}`).click();
  await page.getByRole("option", { name: state, exact: true }).click();
}

async function saveLine(page: Page, item: string) {
  await page
    .getByRole("listitem", { name: new RegExp(item) })
    .getByRole("button", { name: `Save ${item}` })
    .click();
}

async function markUnavailable(page: Page, item: string, reason: string) {
  await chooseArrangementState(page, item, "Unavailable");
  await page.getByLabel(`Reason unavailable for ${item} (required)`).fill(reason);
  await saveLine(page, item);
}

async function eventState(eventId: number) {
  const [event] = await database
    .select({
      status: schema.eventRequests.status,
      completedAt: schema.eventRequests.equipmentArrangementsCompletedAt,
    })
    .from(schema.eventRequests)
    .where(eq(schema.eventRequests.id, eventId));
  return event;
}

/* -------------------------------------------------------------------------- */
/* AC1: Mark arrangements complete                                            */
/* -------------------------------------------------------------------------- */

test.describe("AC1: completing technical arrangements", () => {
  test("records completion only after every line is reserved or not required", async ({ page }) => {
    const reserved = await createType(5);
    const target = await createEvent([
      {
        item: reserved.name,
        quantity: 2,
        state: "reserved",
        assignedStaffId: TECHNICAL_SUPPORT_ID,
        equipmentTypeId: reserved.id,
      },
      {
        item: "No extra cables required",
        state: "not_required",
        equipmentTypeId: reserved.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);
    await openEquipmentPage(page, target.id);

    await page.getByRole("button", { name: "Mark arrangements complete" }).click();
    await expect(page.getByRole("status")).toContainText("Technical arrangements complete");

    const saved = await eventState(target.id);
    expect(saved.status).toBe("planning");
    expect(saved.completedAt).toBeInstanceOf(Date);

    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole("status")).toContainText("Technical arrangements complete");
  });

  test("refuses completion while any line is still requested", async ({ page }) => {
    const type = await createType(5);
    const target = await createEvent([
      {
        item: type.name,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);
    await openEquipmentPage(page, target.id);

    await page.getByRole("button", { name: "Mark arrangements complete" }).click();
    await expect(page.getByRole("alert")).toContainText("Cannot mark arrangements complete");
    expect((await eventState(target.id)).completedAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* AC2: Record equipment unavailable                                          */
/* -------------------------------------------------------------------------- */

test.describe("AC2: recording equipment unavailable", () => {
  test("requires a reason", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 3,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    const line = page.getByRole("listitem", {
      name: new RegExp(type.name),
    });

    await chooseArrangementState(page, type.name, "Unavailable");
    await saveLine(page, type.name);

    await expect(line.getByText(REASON_REQUIRED)).toBeVisible();
  });

  test("refuses a whitespace-only reason", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 1,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    const line = page.getByRole("listitem", {
      name: new RegExp(type.name),
    });

    await chooseArrangementState(page, type.name, "Unavailable");
    await page.getByLabel(`Reason unavailable for ${type.name} (required)`).fill("     ");
    await saveLine(page, type.name);

    await expect(line.getByText(REASON_REQUIRED)).toBeVisible();
  });

  test("marks a requested line unavailable and displays the reason", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 3,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    await markUnavailable(page, type.name, "Out for repair until November");

    const line = page.getByRole("listitem", { name: new RegExp(type.name) });
    await expect(
      line.getByRole("combobox", { name: `Arrangement state for ${type.name}` })
    ).toContainText("Unavailable");
    await expect(
      line.getByRole("textbox", { name: `Reason unavailable for ${type.name} (required)` })
    ).toHaveValue("Out for repair until November");
  });

  test("a reserved line cannot be marked unavailable", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 2,
        state: "reserved",
        assignedStaffId: TECHNICAL_SUPPORT_ID,
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    const line = page.getByRole("listitem", {
      name: new RegExp(type.name),
    });

    await expect(line.getByLabel(`Arrangement state for ${type.name}`)).toBeDisabled();
    await expect(line.getByText(RESERVED_REFUSAL)).toBeVisible();
  });
});

/* -------------------------------------------------------------------------- */
/* AC3: Coordinator outcome                                                   */
/* -------------------------------------------------------------------------- */

test.describe("AC3: Coordinator sees the equipment outcome", () => {
  test("unavailable outcome is visible to the Coordinator", async ({ page, browser }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 3,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    await markUnavailable(page, type.name, "Out for repair");

    const coordinatorContext = await browser.newContext();
    const coordinatorPage = await coordinatorContext.newPage();
    try {
      await signInAsStaff(coordinatorPage, "event_coordinator");
      await coordinatorPage.goto("/dashboard");
      await waitForHydration(coordinatorPage);
      const card = coordinatorPage.locator("[data-slot=card]").filter({ hasText: target.name });
      await expect(card.getByText("Unavailable")).toBeVisible();
      await expect(card.getByText("Reason: Out for repair")).toBeVisible();
    } finally {
      await coordinatorContext.close();
    }
  });
});
/* -------------------------------------------------------------------------- */
/* AC5: Event status unchanged                                                */
/* -------------------------------------------------------------------------- */

test.describe("AC5: event status unchanged", () => {
  test("recording unavailable does not change the event status", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 1,
        state: "requested",
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);

    await openEquipmentPage(page, target.id);

    await markUnavailable(page, type.name, "No stock");

    expect((await eventState(target.id)).status).toBe("planning");
  });
});

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

test.describe("access control", () => {
  test("Coordinator does not see Technical Support completion controls", async ({ page }) => {
    const type = await createType(5);

    const target = await createEvent([
      {
        item: type.name,
        quantity: 2,
        state: "reserved",
        assignedStaffId: TECHNICAL_SUPPORT_ID,
        equipmentTypeId: type.id,
      },
    ]);

    await addBooking(target.id, ["10:00", "12:00"]);
    await signInAsStaff(page, "event_coordinator");
    await page.goto(equipmentUrl(target.id));
    await waitForHydration(page);

    await expect(page.getByRole("button", { name: "Mark arrangements complete" })).toHaveCount(0);
  });
});
