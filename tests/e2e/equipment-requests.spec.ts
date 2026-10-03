// oxlint-disable node/no-process-env
//
// Coordinator equipment panel and the Technical Support work list, against a seeded DB.
// Mutates the shared "ConnectSphere Demo Summit" row: per-test setup runs through
// resetDemoEvent, while beforeAll/afterAll snapshot and restore the row so specs that run
// after this file (e.g. events.test.ts) keep seeing the seed state.
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Pool } from "pg";

import { waitForHydration } from "./hydration";
import { signInAsStaff, signInWithSeedPassword } from "./staff-auth";

const DASHBOARD_PATH = "/dashboard";
const DEMO_EVENT = "ConnectSphere Demo Summit";
const SUBMITTED_CAPTION = "Submitted to Technical Support.";
const EMPTY_STATE_MESSAGE = "No equipment lines recorded. Add at least one line before submitting.";
// Delivery is queued now, so the submit toast no longer varies with the mailer's configuration.
const SUBMIT_TOAST = "Equipment requirements sent to Technical Support.";

const USERS = {
  coordinator: "coordinator.seed@example.com",
  organiser: "jane.doe@example.com",
} as const;

// This file mutates one shared demo row, so its own tests run one at a time.
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

let pool: Pool;

interface DemoSnapshot {
  status: string;
  equipmentSubmittedAt: Date | null;
  decisionReason: string | null;
  decidedByCoordinatorId: string | null;
  decidedByCoordinatorName: string | null;
  decidedAt: Date | null;
  lines: Array<{
    id: string;
    eventId: number;
    assignedStaffId: string | null;
    item: string;
    quantity: number;
    arrangementStatus: string;
    notes: string | null;
  }>;
}

let snapshot: DemoSnapshot | undefined;

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }

  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query("select 1");
  } catch (err) {
    throw new Error(
      `Cannot connect to the database from the e2e tests: ${(err as Error).message}`,
      { cause: err }
    );
  }

  // Verify schema + seed data once, so a bad environment fails here with a clear message.
  try {
    const { rowCount } = await pool.query(`select 1 from event_requests where event_name = $1`, [
      DEMO_EVENT,
    ]);
    if (!rowCount) {
      throw new Error(`Seed event "${DEMO_EVENT}" not found. Did you run \`bun run seed\`?`);
    }
    await pool.query(`select 1 from equipment_requests limit 1`);
    await pool.query(`select equipment_submitted_at from event_requests limit 1`);
  } catch (err) {
    throw new Error(`DB schema/seed check failed: ${(err as Error).message}`, { cause: err });
  }

  // Snapshot the shared row so afterAll can put it back for the specs that run after this file.
  const { rows: eventRows } = await pool.query(
    `select status, equipment_submitted_at, decision_reason, decided_by_coordinator_id,
            decided_by_coordinator_name, decided_at
       from event_requests where event_name = $1`,
    [DEMO_EVENT]
  );
  const { rows: lineRows } = await pool.query(
    `select id, event_id as "eventId", assigned_staff_id as "assignedStaffId", item, quantity,
            arrangement_status as "arrangementStatus", notes
       from equipment_requests
      where event_id in (select id from event_requests where event_name = $1)
      order by id`,
    [DEMO_EVENT]
  );
  const event = eventRows[0];
  if (!event) {
    throw new Error(
      `Seed event "${DEMO_EVENT}" disappeared between the schema check and snapshot.`
    );
  }
  snapshot = {
    status: event.status as string,
    equipmentSubmittedAt: event.equipment_submitted_at as Date | null,
    decisionReason: event.decision_reason as string | null,
    decidedByCoordinatorId: event.decided_by_coordinator_id as string | null,
    decidedByCoordinatorName: event.decided_by_coordinator_name as string | null,
    decidedAt: event.decided_at as Date | null,
    lines: (lineRows as DemoSnapshot["lines"]) ?? [],
  };
});

test.afterAll(async () => {
  // The snapshot is taken in beforeAll; a failure there leaves this undefined, and there is
  // nothing safe to restore. `pool.end()` must still run, otherwise the guard leaks the pool.
  try {
    if (!snapshot) return;
    const client = await pool.connect();
    try {
      // Restore the shared row exactly, so events.test.ts still sees the seeded `submitted`
      // event with its assigned `Projector` line.
      await client.query("begin");
      await client.query(
        `delete from equipment_requests
          where event_id in (select id from event_requests where event_name = $1)`,
        [DEMO_EVENT]
      );
      // oxlint-disable no-await-in-loop
      for (const line of snapshot.lines ?? []) {
        await client.query(
          `insert into equipment_requests
             (id, event_id, assigned_staff_id, item, quantity, arrangement_status, notes)
           values ($1, (select id from event_requests where event_name = $2), $3, $4, $5, $6, $7)
           on conflict (id) do nothing`,
          [
            line.id,
            DEMO_EVENT,
            line.assignedStaffId,
            line.item,
            line.quantity,
            line.arrangementStatus,
            line.notes,
          ]
        );
      }
      // oxlint-enable no-await-in-loop
      const { rowCount } = await client.query(
        `update event_requests
            set status = $1,
                equipment_submitted_at = $2,
                decision_reason = $3,
                decided_by_coordinator_id = $4,
                decided_by_coordinator_name = $5,
                decided_at = $6
          where event_name = $7`,
        [
          snapshot.status,
          snapshot.equipmentSubmittedAt,
          snapshot.decisionReason,
          snapshot.decidedByCoordinatorId,
          snapshot.decidedByCoordinatorName,
          snapshot.decidedAt,
          DEMO_EVENT,
        ]
      );
      if (rowCount !== 1) {
        throw new Error(
          `restore expected to update 1 row for "${DEMO_EVENT}", updated ${rowCount}`
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool?.end();
  }
});

// Statuses that the DB constraint event_requests_decision_matches_status treats as "decided":
// they REQUIRE decided_by_coordinator_id/name and decided_at. All other statuses REQUIRE those
// columns (and decision_reason) to be NULL.
const DECIDED_STATUSES = new Set(["approved", "rejected", "planning", "confirmed", "completed"]);
const SEED_COORDINATOR_ID = "seed-coordinator-1"; // any non-empty text satisfies the constraint
const SEED_COORDINATOR_NAME = "Seed Coordinator";

async function resetDemoEvent(status: string) {
  const decided = DECIDED_STATUSES.has(status);
  const client = await pool.connect();
  try {
    // Transaction: if the update fails, the delete is rolled back too.
    await client.query("begin");
    await client.query(
      `delete from equipment_requests
        where event_id in (select id from event_requests where event_name = $1)`,
      [DEMO_EVENT]
    );

    const { rowCount } = decided
      ? await client.query(
          `update event_requests
              set status = $1,
                  equipment_submitted_at = null,
                  decision_reason = null,
                  decided_by_coordinator_id = $3,
                  decided_by_coordinator_name = $4,
                  decided_at = coalesce(decided_at, now())
            where event_name = $2`,
          [status, DEMO_EVENT, SEED_COORDINATOR_ID, SEED_COORDINATOR_NAME]
        )
      : await client.query(
          `update event_requests
              set status = $1,
                  equipment_submitted_at = null,
                  decision_reason = null,
                  decided_by_coordinator_id = null,
                  decided_by_coordinator_name = null,
                  decided_at = null
            where event_name = $2`,
          [status, DEMO_EVENT]
        );

    if (rowCount !== 1) {
      throw new Error(
        `resetDemoEvent expected to update 1 row for "${DEMO_EVENT}", updated ${rowCount}`
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function countLines(item: string) {
  const { rows } = await pool.query(
    `select count(*)::int as n from equipment_requests
      where item = $1
        and event_id in (select id from event_requests where event_name = $2)`,
    [item, DEMO_EVENT]
  );
  return rows[0].n as number;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

async function openDashboardAs(page: Page, email: string) {
  await signInWithSeedPassword(page, email);
  await page.goto(DASHBOARD_PATH);
  await waitForHydration(page);
}

const card = (page: Page) => page.locator("[data-slot=card]").filter({ hasText: DEMO_EVENT });

// A recorded equipment line in the list. Scoped to list items with an exact match, because the card
// also shows the request's free-text equipment requirements (e.g. "Projector, PA system"), which
// would otherwise make getByText("Projector") ambiguous (strict mode violation).
const lineItem = (page: Page, item: string) =>
  card(page).getByRole("listitem").getByText(item, { exact: true });

const submitButton = (page: Page) =>
  card(page).getByRole("button", { name: "Submit to Technical Support" });

async function addLine(page: Page, item: string, quantity: string, notes = "") {
  const c = card(page);
  await c.getByRole("button", { name: "Add line" }).first().click();
  await c.getByLabel("Equipment type (required)").fill(item);
  await c.getByLabel("Quantity (required)").fill(quantity);
  if (notes) await c.getByLabel("Technical notes").fill(notes);
  await c.getByRole("button", { name: "Add line" }).last().click();
}

async function submitThroughDialog(page: Page) {
  await submitButton(page).click();
  await expect(page.getByRole("alertdialog")).toContainText("equipment line");
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Coordinator flow
// ---------------------------------------------------------------------------

test.describe("Coordinator equipment panel", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoEvent("approved");
    await openDashboardAs(page, USERS.coordinator);
  });

  test("AC1: records several lines with notes", async ({ page }) => {
    await addLine(page, "Projector", "1", "HDMI adapter");
    await expect(lineItem(page, "Projector")).toBeVisible();
    await expect(card(page).getByText("HDMI adapter")).toBeVisible();

    await addLine(page, "Microphone", "2");
    await expect(lineItem(page, "Microphone")).toBeVisible();
    await expect(card(page).getByText("× 2")).toBeVisible();
  });

  test("AC3: non-positive / fractional / blank quantities are refused", async ({ page }) => {
    const c = card(page);
    // oxlint-disable no-await-in-loop
    for (const bad of ["0", "-1", "1.5", ""]) {
      if (!(await c.getByLabel("Quantity (required)").isVisible())) {
        await c.getByRole("button", { name: "Add line" }).first().click();
      }
      await c.getByLabel("Equipment type (required)").fill("Projector");
      await c.getByLabel("Quantity (required)").fill(bad);
      await c.getByRole("button", { name: "Add line" }).last().click();

      // Form stays open and nothing was added.
      await expect(c.getByLabel("Quantity (required)")).toBeVisible();
      await expect(c.getByText("Projector ×")).toHaveCount(0);
      await expect(c.getByText(EMPTY_STATE_MESSAGE)).toHaveCount(0); // form open, empty-state hidden
    }
    // oxlint-enable no-await-in-loop
    expect(await countLines("Projector")).toBe(0);

    await c.getByLabel("Quantity (required)").fill("3");
    await c.getByRole("button", { name: "Add line" }).last().click();
    await expect(c.getByText("× 3")).toBeVisible();
  });

  test("AC4: edit persists after reload; remove can be cancelled then confirmed", async ({
    page,
  }) => {
    await addLine(page, "Projector", "1");

    await page.getByRole("button", { name: "Edit Projector" }).click();
    await card(page).getByLabel("Quantity (required)").fill("4");
    await card(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Equipment line updated.")).toBeVisible();
    await page.reload();
    await expect(card(page).getByText("× 4")).toBeVisible();

    // Cancel keeps the line.
    await page.getByRole("button", { name: "Remove Projector" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(lineItem(page, "Projector")).toBeVisible();

    // Confirm removes it, leaving exactly one empty-state message.
    await page.getByRole("button", { name: "Remove Projector" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(card(page).getByText(EMPTY_STATE_MESSAGE)).toHaveCount(1);
  });

  test("AC5: submit is disabled with no lines", async ({ page }) => {
    const submit = submitButton(page);
    await expect(submit).toBeDisabled();
    await expect(card(page).getByText(EMPTY_STATE_MESSAGE)).toBeVisible();

    await addLine(page, "Projector", "1");
    await expect(submit).toBeEnabled();
  });

  test("AC5: submit confirms, toasts, and stamps the event", async ({ page }) => {
    await addLine(page, "Projector", "1");
    await submitThroughDialog(page);
    await expect(page.getByText(SUBMIT_TOAST)).toBeVisible();

    const { rows } = await pool.query(
      `select equipment_submitted_at from event_requests where event_name = $1`,
      [DEMO_EVENT]
    );
    expect(rows[0].equipment_submitted_at).not.toBeNull();
  });

  test("AC5: submit is disabled after submission, and the panel goes read-only", async ({
    page,
  }) => {
    await addLine(page, "Projector", "1");
    await submitThroughDialog(page);

    await expect(submitButton(page)).toBeDisabled();
    await expect(card(page).getByText(SUBMITTED_CAPTION)).toBeVisible();
    // Post-submit freeze: no add, edit or remove controls, but the disabled Submit stays.
    await expect(card(page).getByRole("button", { name: "Add line" })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: /Edit / })).toHaveCount(0);
    await expect(card(page).getByRole("button", { name: /Remove / })).toHaveCount(0);

    await page.reload();
    await expect(card(page)).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(submitButton(page)).toBeDisabled();
    await expect(card(page).getByText(SUBMITTED_CAPTION)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Add line" })).toHaveCount(0);
  });

  test("double-clicking Save creates one line", async ({ page }) => {
    const c = card(page);
    await c.getByRole("button", { name: "Add line" }).first().click();
    await c.getByLabel("Equipment type (required)").fill("Projector");
    await c.getByLabel("Quantity (required)").fill("1");
    await c.getByRole("button", { name: "Add line" }).last().dblclick();

    await expect(lineItem(page, "Projector")).toBeVisible();
    // Poll so a slow second insert can't sneak in after the check.
    await expect.poll(() => countLines("Projector")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Read-only states and other roles
// ---------------------------------------------------------------------------

test.describe("Read-only states and other roles", () => {
  // oxlint-disable no-await-in-loop
  for (const status of ["submitted", "under_review"]) {
    test(`coordinator: no edit controls on a ${status} event`, async ({ page }) => {
      await resetDemoEvent(status);
      await openDashboardAs(page, USERS.coordinator);

      await expect(card(page)).toBeVisible(); // make sure the card rendered before asserting absence
      await expect(card(page).getByRole("button", { name: "Add line" })).toHaveCount(0);
      await expect(
        card(page).getByRole("button", { name: "Submit to Technical Support" })
      ).toHaveCount(0);
    });
  }

  test("organiser cannot edit equipment", async ({ page }) => {
    await resetDemoEvent("approved");
    await openDashboardAs(page, USERS.organiser);

    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Add line" })).toHaveCount(0);
  });

  test("technical support sees a read-only list", async ({ page }) => {
    await resetDemoEvent("approved");
    // The demo row is assigned to seed-tech-support-1, so it is connected. Re-create one line.
    await pool.query(
      `insert into equipment_requests (id, event_id, assigned_staff_id, item, quantity, notes)
       select 'e2e-line-1', id, 'seed-tech-support-1', 'Projector', 1, 'HDMI adapter included'
         from event_requests where event_name = $1`,
      [DEMO_EVENT]
    );
    await signInAsStaff(page, "technical_support_staff");
    await page.goto(DASHBOARD_PATH);

    await expect(card(page).getByText("Equipment arrangements")).toBeVisible();
    await expect(lineItem(page, "Projector")).toBeVisible();
    await expect(card(page).getByText("× 1")).toBeVisible();
    await expect(card(page).getByText("HDMI adapter included")).toBeVisible();
    await expect(card(page).getByText("Requested")).toBeVisible();
    await expect(card(page).getByRole("button", { name: /Add line|Submit/ })).toHaveCount(0);
  });

  test("venue staff see no equipment", async ({ page }) => {
    await resetDemoEvent("approved");
    await signInAsStaff(page, "venue_staff");
    await page.goto(DASHBOARD_PATH);

    // Wait for the dashboard to finish rendering before asserting that something is absent.
    await expect(page.getByRole("main")).toBeVisible();
    // Positive proof the venue workspace rendered, so the absence below is meaningful.
    await expect(page.getByText("venue staff access").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Venue request" })).toBeVisible();
    await expect(page.getByText(/Equipment (requirements|arrangements)/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Submitted queue across roles
// ---------------------------------------------------------------------------

// End-to-end AC5: a line submitted by the Coordinator with no assignee reaches the shared
// Technical Support queue, so a staffer with no prior assignment sees the event.
test("AC5: a submitted event appears for a Technical Support user with no prior assignment", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  await resetDemoEvent("approved");
  await openDashboardAs(page, USERS.coordinator);
  await addLine(page, "Speaker", "2", "Wall mounts");
  await submitThroughDialog(page);
  await expect(page.getByText(SUBMIT_TOAST)).toBeVisible();

  const techContext = await browser.newContext();
  const techPage = await techContext.newPage();
  try {
    await signInAsStaff(techPage, "technical_support_staff");
    await techPage.goto(DASHBOARD_PATH);

    await expect(card(techPage)).toBeVisible();
    await expect(card(techPage).getByText("Equipment arrangements")).toBeVisible();
    await expect(lineItem(techPage, "Speaker")).toBeVisible();
    await expect(card(techPage).getByText("× 2")).toBeVisible();
    await expect(card(techPage).getByText("Wall mounts")).toBeVisible();
  } finally {
    await techContext.close();
  }
});
