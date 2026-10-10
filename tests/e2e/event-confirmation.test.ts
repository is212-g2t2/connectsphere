// oxlint-disable node/no-process-env
//
// PTR-24: the assigned Coordinator confirms an event, the refusal names what is outstanding, and
// the Organiser sees the confirmed arrangements. Every test creates and removes its own event and
// booking, so the tests can run in parallel and never touch the shared demo rows.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
const ORGANISER_EMAIL = "jane.doe@example.com";
const ORGANISER_ID = "test-user-2";

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
      .delete(schema.equipmentRequests)
      .where(inArray(schema.equipmentRequests.eventId, created));
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

interface Seed {
  booking?: "approved" | "pending";
  lines?: { item: string; arrangementStatus: "requested" | "reserved" | "not_required" }[];
}

/** An approved event assigned to the seeded Coordinator, with the arrangements the test names. */
async function createEvent({ booking, lines = [] }: Seed) {
  const name = `PTR-24 E2E ${crypto.randomUUID().slice(0, 8)}`;
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
      // PTR-43: Technical Support marked the arrangements complete once lines exist.
      equipmentArrangementsCompletedAt: lines.length > 0 ? new Date() : null,
      eventName: name,
      purpose: "test",
      proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
      expectedAttendance: 10,
      eventType: "Conference",
    })
    .returning({ id: schema.eventRequests.id });
  created.push(row.id);

  if (booking) {
    // A random far-future day per event keeps parallel tests clear of the venue overlap constraint.
    const year = 2100 + Math.floor(Math.random() * 800);
    const day = 1 + Math.floor(Math.random() * 28);
    const date = `${year}-03-${String(day).padStart(2, "0")}`;
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: row.id,
      venueId,
      requestedById: COORDINATOR_ID,
      startsAt: `${date} 09:00:00`,
      endsAt: `${date} 12:30:00`,
      status: booking,
    });
  }
  if (lines.length > 0) {
    await database.insert(schema.equipmentRequests).values(
      lines.map(line => ({
        id: crypto.randomUUID(),
        eventId: row.id,
        quantity: 1,
        ...line,
      }))
    );
  }
  return { id: row.id, name };
}

const statusOf = async (id: number) =>
  (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0]
    .status;

async function openEventPage(page: Page, id: number) {
  await signInWithSeedPassword(page, COORDINATOR_EMAIL);
  await page.goto(`/events/${id}`);
  await waitForHydration(page);
}

async function confirmFromPage(page: Page, name: string) {
  await page.getByRole("button", { name: `Confirm event: ${name}` }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
}

test.describe("AC1: confirming", () => {
  test("the Coordinator confirms an event whose arrangements are in place", async ({ page }) => {
    const { id, name } = await createEvent({
      booking: "approved",
      lines: [
        { item: "Projector", arrangementStatus: "reserved" },
        { item: "Microphone", arrangementStatus: "not_required" },
      ],
    });
    await openEventPage(page, id);

    await confirmFromPage(page, name);

    await expect(page.getByText("Event confirmed. The Organiser will be notified.")).toBeVisible();
    const venue = page.locator("section#venue");
    await expect(venue.getByText("Confirmed venue")).toBeVisible();
    await expect(venue.getByText(venueName)).toBeVisible();
    await expect(page.getByRole("button", { name: `Confirm event: ${name}` })).toHaveCount(0);
    expect(await statusOf(id)).toBe("confirmed");
  });

  // AC5
  test("confirms on the venue booking alone when no equipment is recorded", async ({ page }) => {
    const { id, name } = await createEvent({ booking: "approved" });
    await openEventPage(page, id);

    await confirmFromPage(page, name);

    await expect(page.getByText("Event confirmed. The Organiser will be notified.")).toBeVisible();
    expect(await statusOf(id)).toBe("confirmed");
  });
});

test.describe("AC2: refusal", () => {
  test("shows the outstanding items when confirmation is refused", async ({ page }) => {
    const { id, name } = await createEvent({
      booking: "pending",
      lines: [
        { item: "Projector", arrangementStatus: "requested" },
        { item: "Speaker", arrangementStatus: "reserved" },
      ],
    });
    await openEventPage(page, id);

    await confirmFromPage(page, name);

    // The dialog stays open on a refusal, so the named items show inside it.
    const alert = page.getByRole("alertdialog").getByRole("alert");
    await expect(alert).toContainText("This event cannot be confirmed yet:");
    await expect(alert).toContainText("There is no approved venue booking.");
    await expect(alert).toContainText("Projector is not arranged (requested).");
    await expect(alert).not.toContainText("Speaker");
    expect(await statusOf(id)).toBe("approved");
  });
});

test.describe("AC3 and AC4: the Organiser", () => {
  test("sees the confirmed arrangements and is emailed", async ({ page, browser }) => {
    const { id, name } = await createEvent({
      booking: "approved",
      lines: [{ item: "Projector", arrangementStatus: "reserved" }],
    });
    await openEventPage(page, id);
    await confirmFromPage(page, name);
    await expect(page.getByText("Event confirmed. The Organiser will be notified.")).toBeVisible();

    const organiserContext = await browser.newContext();
    const organiserPage = await organiserContext.newPage();
    try {
      await signInWithSeedPassword(organiserPage, ORGANISER_EMAIL);
      await organiserPage.goto(`/events/${id}`);
      await waitForHydration(organiserPage);

      await expect(organiserPage.getByText("Confirmed", { exact: true }).first()).toBeVisible();
      const venue = organiserPage.locator("section#venue");
      await expect(venue.getByText(venueName)).toBeVisible();
      await expect(venue.getByText("09:00–12:30")).toBeVisible();
      const equipment = organiserPage.locator("section#equipment");
      await expect(equipment.getByText("Projector")).toBeVisible();
      // Equipment is shown as a state, never with Technical Support's own notes.
      await expect(
        organiserPage.getByRole("button", { name: `Confirm event: ${name}` })
      ).toHaveCount(0);
    } finally {
      await organiserContext.close();
    }

    const body = await waitForEmail(ORGANISER_EMAIL, `Event confirmed: ${name}`);
    expect(body).toContain(name);
    expect(body).toContain(venueName);
  });
});
