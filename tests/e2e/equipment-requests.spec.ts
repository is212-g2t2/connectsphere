// e2e/equipment-requests.spec.ts
// oxlint-disable node/no-process-env
//
// Runs against a dev server with a seeded DB (bun run seed). Direct SQL resets state befores each
// test so the specs don't depend on clicking through the whole approval flow (that flow is covered
// by the last test). Adjust LOGIN_PATH, DASHBOARD_PATH and the login labels to your app.
//
// Requirements:
//   - DATABASE_URL must be visible to the Playwright process. Playwright does NOT load .env itself,
//     so add `import "dotenv/config"` (or dotenv.config({ path: ".env.test" })) to playwright.config.ts.
//   - Migrations applied and `bun run seed` run before the tests.
//   - This file mutates one shared demo event, so it must not run in parallel with other specs that
//     touch the same row. Use `workers: 1` in playwright.config.ts (or a project with dependencies).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Pool } from "pg";

const LOGIN_PATH = "/login";
const DASHBOARD_PATH = "/dashboard";
const PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "Seed-Pass123!";
const DEMO_EVENT = "ConnectSphere Demo Summit";

const USERS = {
  coordinator: "coordinator.seed@example.com",
  organiser: "jane.doe@example.com",
  techSupport: "tech.support.seed@example.com",
  venueStaff: "venue.staff.seed@example.com",
} as const;

// Force tests in this file to run in order in a single worker, even if fullyParallel is on.
// (Unlike "serial", "default" does not skip the remaining tests after one failure.)
test.describe.configure({ mode: "default" });

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

let pool: Pool;

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set in the Playwright process. Load it in playwright.config.ts " +
        '(e.g. `import "dotenv/config"`) or pass it via the environment / CI secrets.'
    );
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
});

test.afterAll(async () => {
  await pool?.end();
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

async function login(page: Page, email: string) {
  await page.goto(LOGIN_PATH);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith(LOGIN_PATH), {
    timeout: 10_000,
  });
}

async function openDashboardAs(page: Page, email: string) {
  await login(page, email);
  await page.goto(DASHBOARD_PATH);
}

const card = (page: Page) => page.locator("[data-slot=card]").filter({ hasText: DEMO_EVENT });

// A recorded equipment line in the list. Scoped to list items with an exact match, because the card
// also shows the request's free-text equipment requirements (e.g. "Projector, PA system"), which
// would otherwise make getByText("Projector") ambiguous (strict mode violation).
const lineItem = (page: Page, item: string) =>
  card(page).getByRole("listitem").getByText(item, { exact: true });

async function addLine(page: Page, item: string, quantity: string, notes = "") {
  const c = card(page);
  await c.getByRole("button", { name: "Add line" }).first().click();
  await c.getByLabel("Equipment type (required)").fill(item);
  await c.getByLabel("Quantity (required)").fill(quantity);
  if (notes) await c.getByLabel("Technical notes").fill(notes);
  await c.getByRole("button", { name: "Add line" }).last().click();
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
      await expect(c.getByText("No equipment lines recorded yet.")).toHaveCount(0); // form open, empty-state hidden
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
    await page.reload();
    await expect(card(page).getByText("× 4")).toBeVisible();

    // Cancel keeps the line.
    await page.getByRole("button", { name: "Remove Projector" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(lineItem(page, "Projector")).toBeVisible();

    // Confirm removes it.
    await page.getByRole("button", { name: "Remove Projector" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(card(page).getByText("No equipment lines recorded yet.")).toBeVisible();
  });

  test("AC5: submit is disabled with no lines", async ({ page }) => {
    const submit = card(page).getByRole("button", {
      name: "Submit to Technical Support",
    });
    await expect(submit).toBeDisabled();
    await expect(card(page).getByText(/Add at least one line before submitting/)).toBeVisible();

    await addLine(page, "Projector", "1");
    await expect(submit).toBeEnabled();
  });

  test("AC5: submit confirms, toasts, and stamps the event", async ({ page }) => {
    await addLine(page, "Projector", "1");
    await card(page).getByRole("button", { name: "Submit to Technical Support" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("1 equipment line");
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Equipment requirements sent to Technical Support.")).toBeVisible();

    const { rows } = await pool.query(
      `select equipment_submitted_at from event_requests where event_name = $1`,
      [DEMO_EVENT]
    );
    expect(rows[0].equipment_submitted_at).not.toBeNull();
  });

  // Fails until EquipmentPanel actually receives/uses `submittedAt`.
  test.fixme("AC5: submit is disabled after submission", async ({ page }) => {
    await addLine(page, "Projector", "1");
    await card(page).getByRole("button", { name: "Submit to Technical Support" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(
      card(page).getByRole("button", { name: /Submit to Technical Support/ })
    ).toBeDisabled();
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
      `insert into equipment_requests (id, event_id, assigned_staff_id, item, quantity)
       select 'e2e-line-1', id, 'seed-tech-support-1', 'Projector', 1
         from event_requests where event_name = $1`,
      [DEMO_EVENT]
    );
    await openDashboardAs(page, USERS.techSupport);

    await expect(card(page).getByText("Equipment arrangements")).toBeVisible();
    await expect(card(page).getByRole("button", { name: /Add line|Submit/ })).toHaveCount(0);
  });

  test("venue staff see no equipment", async ({ page }) => {
    await resetDemoEvent("approved");
    await openDashboardAs(page, USERS.venueStaff);

    // Wait for the dashboard to finish rendering before asserting that something is absent.
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/Equipment (requirements|arrangements)/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Known gap
// ---------------------------------------------------------------------------

// Main-gap check: after a real submit, does Technical Support get the event? With
// `assigned_staff_id` never set, this is expected to fail today.
test.fixme("AC5: a submitted event appears for a Technical Support user with no prior assignment", async ({
  page,
}) => {
  await resetDemoEvent("approved");
  // 1. Coordinator adds a line and submits (assigned_staff_id stays null).
  // 2. Log in as tech.support.seed@example.com.
  // 3. expect(card(page)).toBeVisible()
  await openDashboardAs(page, USERS.techSupport);
  await expect(card(page)).toBeVisible();
});
