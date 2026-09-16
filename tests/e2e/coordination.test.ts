// Browser actions share a page and must run in order.
// oxlint-disable node/no-process-env, no-await-in-loop
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";

import * as schema from "../../src/db/schema";

const password = "Coordinate123!";
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});
test.afterAll(async () => {
  await pool.end();
});

async function register(page: Page, role: "event_organiser" | "event_coordinator", name: string) {
  const email = `coordination-${randomUUID()}@example.invalid`;
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: { name, email, password, role: "event_organiser" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const [account] = await database.select().from(schema.user).where(eq(schema.user.email, email));
  if (role === "event_coordinator") {
    // Provision only this test's own account; self-registration cannot grant an internal role.
    await database.update(schema.user).set({ role }).where(eq(schema.user.id, account.id));
    const logout = await page.request.post("/api/auth/sign-out", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(logout.ok(), await logout.text()).toBe(true);
    const login = await page.request.post("/api/auth/sign-in/email", {
      headers: { Origin: "http://localhost:3000" },
      data: { email, password },
    });
    expect(login.ok(), await login.text()).toBe(true);
  }
  return account;
}

test("redirects unauthenticated visitors from the coordination detail", async ({ page }) => {
  await page.goto("/coordination/1");
  await expect(page).toHaveURL(/\/login/);
});

test("answers not found for a junk request id instead of the error boundary", async ({ page }) => {
  const coordinator = await register(page, "event_coordinator", "Junk Id Coordinator");
  try {
    await page.goto("/coordination/abc");
    await expect(page.getByText(/not found/i)).toBeVisible();
  } finally {
    await database.delete(schema.user).where(eq(schema.user.id, coordinator.id));
  }
});

test("hands over an event and transfers access", async ({ page, browser, baseURL }) => {
  const incomingContext = await browser.newContext({ baseURL });
  const organiserContext = await browser.newContext({ baseURL });
  const incomingPage = await incomingContext.newPage();
  const organiserPage = await organiserContext.newPage();
  const ids: string[] = [];
  try {
    const outgoing = await register(page, "event_coordinator", "Outgoing Coordinator");
    ids.push(outgoing.id);
    const incoming = await register(incomingPage, "event_coordinator", "Incoming Coordinator");
    ids.push(incoming.id);
    const organiser = await register(organiserPage, "event_organiser", "Handover Organiser");
    ids.push(organiser.id);
    const eventName = `Handover ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: outgoing.id,
        assignedAt: new Date(),
        purpose: "Coordinate a workshop",
        expectedAttendance: 25,
      })
      .returning();

    await organiserPage.goto(`/coordination/${request.id}`);
    await expect(organiserPage).toHaveURL(/\/dashboard$/);
    await page.goto("/coordination");
    await page.getByRole("link", { name: eventName }).click();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Event Coordinator", { exact: true }).selectOption(incoming.id);
    await page.getByRole("button", { name: "Reassign Coordinator" }).click();
    await expect(page).toHaveURL(/\/coordination\/?$/);
    await expect(page.getByRole("link", { name: eventName })).toHaveCount(0);

    await page.goto(`/coordination/${request.id}`);
    await expect(
      page.getByText(
        "You no longer have coordination access to this request, or it is unavailable."
      )
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reassign Coordinator" })).toHaveCount(0);
    await incomingPage.goto(`/coordination/${request.id}`);
    await expect(incomingPage.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(incomingPage.getByRole("button", { name: "Reassign Coordinator" })).toBeVisible();

    await organiserPage.goto(`/event-requests/${request.id}`);
    await expect(organiserPage.getByRole("link", { name: incoming.email })).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await incomingContext.close();
    await organiserContext.close();
  }
});

test("picks up unassigned events for yourself or a named Coordinator", async ({
  page,
  browser,
  baseURL,
}) => {
  const otherContext = await browser.newContext({ baseURL });
  const otherPage = await otherContext.newPage();
  const ids: string[] = [];
  try {
    const actor = await register(page, "event_coordinator", "Pickup Coordinator");
    ids.push(actor.id);
    const other = await register(otherPage, "event_coordinator", "Named Coordinator");
    ids.push(other.id);
    // Use a unique organiser row so this test owns all its fixtures and cleanup cascades.
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Pickup Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    for (const target of [actor, other]) {
      const eventName = `Pickup ${randomUUID()}`;
      const [request] = await database
        .insert(schema.eventRequests)
        .values({ organiserId, eventName, status: "submitted", submittedAt: new Date() })
        .returning();
      await page.goto("/coordination");
      await page.getByRole("link", { name: eventName }).click();
      await page.waitForLoadState("networkidle");
      if (target.id === actor.id) {
        await page.getByRole("button", { name: "Assign to me" }).click();
      } else {
        await page.getByLabel("Event Coordinator", { exact: true }).selectOption(target.id);
        await page.getByRole("button", { name: "Assign Coordinator", exact: true }).click();
      }
      await expect(page).toHaveURL(/\/coordination\/?$/);
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(stored.assignedCoordinatorId).toBe(target.id);
      const [audit] = await database
        .select()
        .from(schema.eventAssignments)
        .where(eq(schema.eventAssignments.eventRequestId, request.id));
      expect(audit.actorId).toBe(actor.id);
      expect(audit.fromCoordinatorId).toBeNull();
    }
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await otherContext.close();
  }
});
