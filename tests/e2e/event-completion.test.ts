// oxlint-disable node/no-process-env
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
const ORGANISER_ID = "test-user-2";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
let venueId: number;
const created: number[] = [];

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in Playwright.");
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  venueId = (await database.select({ id: schema.venues.id }).from(schema.venues).limit(1))[0].id;
});

test.afterEach(async () => {
  if (created.length === 0) return;
  await database.delete(schema.venueRequests).where(inArray(schema.venueRequests.eventId, created));
  await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
  created.length = 0;
});

test.afterAll(async () => {
  await pool?.end();
});

async function createConfirmedEvent(endsAt: string) {
  const name = `PTR-25 E2E ${crypto.randomUUID().slice(0, 8)}`;
  const [event] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: ORGANISER_ID,
      status: "confirmed",
      submittedAt: new Date(),
      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),
      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seeded Event Coordinator",
      decidedAt: new Date(),
      confirmedById: COORDINATOR_ID,
      confirmedByName: "Seeded Event Coordinator",
      confirmedAt: new Date(),
      eventName: name,
      purpose: "test",
      proposedDates: [
        {
          start: `${endsAt.slice(0, 10)}T09:00`,
          end: endsAt.slice(0, 16).replace(" ", "T"),
        },
      ],
      expectedAttendance: 10,
      eventType: "Conference",
    })
    .returning();
  created.push(event.id);
  await database.insert(schema.venueRequests).values({
    id: crypto.randomUUID(),
    eventId: event.id,
    venueId,
    requestedById: COORDINATOR_ID,
    startsAt: `${endsAt.slice(0, 10)} 09:00:00`,
    endsAt,
    status: "approved",
  });
  return { id: event.id, name };
}

test("the Coordinator explicitly completes an ended confirmed event", async ({ page }) => {
  const event = await createConfirmedEvent("2020-03-10 12:30:00");
  await signInWithSeedPassword(page, COORDINATOR_EMAIL);
  await page.goto("/dashboard");
  await waitForHydration(page);

  const card = page.locator("[data-slot=card]").filter({ hasText: event.name });
  await card.getByRole("button", { name: `Complete event: ${event.name}` }).click();
  await page.getByRole("button", { name: "Mark completed", exact: true }).click();

  await expect(page.getByText("Event marked as completed.")).toBeVisible();
  await expect(card.getByText("Completed", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: `Complete event: ${event.name}` })).toHaveCount(0);
  const [saved] = await database
    .select()
    .from(schema.eventRequests)
    .where(eq(schema.eventRequests.id, event.id));
  expect(saved.completedById).toBe(COORDINATOR_ID);
  expect(saved.completedAt).toBeInstanceOf(Date);
});

test("the action explains that a confirmed event has not ended", async ({ page }) => {
  const event = await createConfirmedEvent("2100-03-10 12:30:00");
  await signInWithSeedPassword(page, COORDINATOR_EMAIL);
  await page.goto("/dashboard");
  await waitForHydration(page);

  const card = page.locator("[data-slot=card]").filter({ hasText: event.name });
  await expect(card.getByRole("button", { name: `Complete event: ${event.name}` })).toBeDisabled();
  await expect(card.getByText("The event end date and time has not passed.")).toBeVisible();
});
