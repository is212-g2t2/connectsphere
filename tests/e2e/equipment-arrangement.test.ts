// oxlint-disable node/no-process-env
//
// PTR-39: the Technical Support work list, the request detail, and the Coordinator seeing the
// result. Every test creates and removes its own event, so it never touches the shared demo row
// that equipment-requests.spec.ts snapshots and restores, and the tests can run in parallel.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { signInAsStaff, signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
const TECH_SUPPORT_ID = "seed-tech-support-1";
const REASON_MESSAGE = "Give a reason for marking this line unavailable";
const SAVED_TOAST = "Equipment line updated.";

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
    await database
      .delete(schema.equipmentRequests)
      .where(inArray(schema.equipmentRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  }
});

test.afterAll(async () => {
  await pool?.end();
});

interface LineSeed {
  item: string;
  quantity?: number;
  notes?: string;
  arrangementStatus?: "requested" | "reserved" | "not_required" | "unavailable";
  assignedStaffId?: string;
}

/** An approved event on 1 Jan 2030, 09:00–17:00, with its equipment submitted (or not). */
async function createEvent(lines: LineSeed[], submitted = true) {
  const name = `PTR-39 E2E ${crypto.randomUUID().slice(0, 8)}`;
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
      equipmentSubmittedAt: submitted ? new Date() : null,
      eventName: name,
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
  created.push(row.id);

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

const lineFor = (eventId: number, item: string) =>
  database
    .select()
    .from(schema.equipmentRequests)
    .where(eq(schema.equipmentRequests.eventId, eventId))
    .then(rows => rows.find(row => row.item === item));

async function openRequest(page: Page, eventId: number) {
  await signInAsStaff(page, "technical_support_staff");
  await page.goto(`/equipment-requests/${eventId}`);
  await waitForHydration(page);
}

const lineItem = (page: Page, item: string) => page.getByRole("listitem", { name: item });

async function chooseState(page: Page, item: string, label: string) {
  await lineItem(page, item).getByLabel(`Arrangement state for ${item}`).click();
  await page.getByRole("option", { name: label }).click();
}

async function saveLine(page: Page, item: string) {
  await lineItem(page, item)
    .getByRole("button", { name: `Save ${item}` })
    .click();
}

test.describe("AC1: the work list", () => {
  test("lists a submitted request on the work list", async ({ page }) => {
    const { name } = await createEvent([{ item: "Projector", quantity: 2 }]);
    await signInAsStaff(page, "technical_support_staff");

    await page.goto("/equipment-requests");

    await expect(page.getByRole("heading", { name: "Equipment requests" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Open equipment request for ${name}` })
    ).toBeVisible();
  });
});

test.describe("AC2: the request detail", () => {
  test("opens a listed request and shows every line", async ({ page }) => {
    const { id, name } = await createEvent([
      { item: "Projector", quantity: 2, notes: "Needs HDMI" },
      { item: "Microphone", quantity: 4 },
    ]);
    await signInAsStaff(page, "technical_support_staff");
    await page.goto("/equipment-requests");

    await page.getByRole("link", { name: `Open equipment request for ${name}` }).click();

    await expect(page).toHaveURL(new RegExp(`/equipment-requests/${id}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("1 Jan 2030")).toBeVisible();
    await expect(page.getByText("09:00–17:00")).toBeVisible();
    await expect(lineItem(page, "Projector")).toContainText("× 2");
    await expect(lineItem(page, "Projector")).toContainText("Needs HDMI");
    await expect(lineItem(page, "Microphone")).toContainText("× 4");
  });

  test("does not open a request the member is not connected to", async ({ page }) => {
    // Not submitted, so the draft still belongs to the Coordinator alone.
    const { id, name } = await createEvent([{ item: "Projector" }], false);
    await signInAsStaff(page, "technical_support_staff");

    await page.goto(`/equipment-requests/${id}`);
    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);

    // An id that does not exist is refused the same way, so neither confirms anything.
    await page.goto("/equipment-requests/2147483000");
    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
  });
});

test.describe("AC3: updating a line", () => {
  test("marks a line not required and keeps it after reload", async ({ page }) => {
    const { id } = await createEvent([{ item: "Projector" }]);
    await openRequest(page, id);

    await chooseState(page, "Projector", "Not required");
    await saveLine(page, "Projector");
    await expect(page.getByText(SAVED_TOAST)).toBeVisible();

    await page.reload();
    await expect(
      lineItem(page, "Projector").getByLabel("Arrangement state for Projector")
    ).toContainText("Not required");
    expect((await lineFor(id, "Projector"))?.arrangementStatus).toBe("not_required");
  });

  test("refuses unavailable without a reason", async ({ page }) => {
    const { id } = await createEvent([{ item: "Projector" }]);
    await openRequest(page, id);

    await chooseState(page, "Projector", "Unavailable");
    await saveLine(page, "Projector");

    await expect(lineItem(page, "Projector")).toContainText(REASON_MESSAGE);
    expect(await lineFor(id, "Projector")).toMatchObject({
      arrangementStatus: "requested",
      unavailableReason: null,
    });

    await lineItem(page, "Projector")
      .getByLabel("Reason unavailable for Projector (required)")
      .fill("Loaned out");
    await saveLine(page, "Projector");
    await expect(page.getByText(SAVED_TOAST)).toBeVisible();
    expect(await lineFor(id, "Projector")).toMatchObject({
      arrangementStatus: "unavailable",
      unavailableReason: "Loaned out",
    });
  });

  test("saves a note on a line", async ({ page }) => {
    const { id } = await createEvent([{ item: "Projector", notes: "Coordinator note" }]);
    await openRequest(page, id);

    await lineItem(page, "Projector")
      .getByLabel("Technical Support notes for Projector")
      .fill("Adapter in store B");
    await saveLine(page, "Projector");
    await expect(page.getByText(SAVED_TOAST)).toBeVisible();

    await page.reload();
    await expect(
      lineItem(page, "Projector").getByLabel("Technical Support notes for Projector")
    ).toHaveValue("Adapter in store B");
    expect(await lineFor(id, "Projector")).toMatchObject({
      notes: "Coordinator note",
      arrangementNotes: "Adapter in store B",
    });
  });

  test("locks the state of a reserved line", async ({ page }) => {
    const { id } = await createEvent([
      { item: "Projector", arrangementStatus: "reserved", assignedStaffId: TECH_SUPPORT_ID },
    ]);
    await openRequest(page, id);

    await expect(
      lineItem(page, "Projector").getByLabel("Arrangement state for Projector")
    ).toBeDisabled();
    await expect(lineItem(page, "Projector")).toContainText(
      "This line holds a reservation. Release the reservation before changing its state."
    );
    await expect(
      lineItem(page, "Projector").getByLabel("Technical Support notes for Projector")
    ).toBeEnabled();
  });
});

test.describe("AC4: what the Coordinator sees", () => {
  test("the Coordinator sees what Technical Support saved", async ({ page, browser }) => {
    const { id, name } = await createEvent([{ item: "Projector" }, { item: "Microphone" }]);
    await openRequest(page, id);
    await chooseState(page, "Projector", "Unavailable");
    await lineItem(page, "Projector")
      .getByLabel("Reason unavailable for Projector (required)")
      .fill("Loaned out");
    await saveLine(page, "Projector");
    await expect(page.getByText(SAVED_TOAST)).toBeVisible();
    await lineItem(page, "Microphone")
      .getByLabel("Technical Support notes for Microphone")
      .fill("Battery pack included");
    await saveLine(page, "Microphone");
    await expect(page.getByText(SAVED_TOAST).last()).toBeVisible();

    const coordinatorContext = await browser.newContext();
    const coordinatorPage = await coordinatorContext.newPage();
    try {
      await signInWithSeedPassword(coordinatorPage, COORDINATOR_EMAIL);
      await coordinatorPage.goto("/dashboard");

      const card = coordinatorPage.locator("[data-slot=card]").filter({ hasText: name });
      await expect(card.getByText("Unavailable")).toBeVisible();
      await expect(card.getByText("Reason: Loaned out")).toBeVisible();
      await expect(card.getByText("Technical Support note: Battery pack included")).toBeVisible();
    } finally {
      await coordinatorContext.close();
    }
  });
});
