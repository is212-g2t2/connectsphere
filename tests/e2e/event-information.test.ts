// oxlint-disable node/no-process-env
//
// PTR-22: the assigned Coordinator updates an approved event's information from the coordination
// page, the change log records it, and the Organiser sees only the new value. Every test creates
// and removes its own event, so the tests can run in parallel and never touch the demo rows.
import { expect, test } from "@playwright/test";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
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
  await page.goto(`/coordination/${id}`);
  await waitForHydration(page);

  await page.getByRole("button", { name: "Edit event information" }).click();
  await page.getByLabel("Event name (required)").fill(renamed);
  await page.getByLabel("Expected attendance (required)").fill("65");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Event information saved.")).toBeVisible();
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
  await page.goto(`/event-requests/${id}`);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The router now holds the detail page's data. Leave it, then let the update land.
  await page.getByRole("link", { name: "Back to event requests" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await database
    .update(schema.eventRequests)
    .set({ eventName: renamed })
    .where(eq(schema.eventRequests.id, id));

  // Record every page heading from here on, so a cached copy shown for one frame still counts.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenHeadings: seen });
    new MutationObserver(() => {
      const heading = document.querySelector("h1")?.textContent;
      if (heading) seen.push(heading);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole("link", { name, exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  const seen = await page.evaluate(
    () => (window as unknown as { seenHeadings: string[] }).seenHeadings
  );
  expect(seen).not.toContain(name);
});
