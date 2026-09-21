// Browser actions share a page and must run in order.
// oxlint-disable node/no-process-env, no-await-in-loop
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";

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
    await waitForHydration(page);
    await page.locator("#coordinatorId").click();
    await page.getByRole("option", { name: incoming.name }).click();
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
      await waitForHydration(page);
      if (target.id === actor.id) {
        await page.getByRole("button", { name: "Assign to me" }).click();
      } else {
        await page.locator("#coordinatorId").click();
        await page.getByRole("option", { name: target.name }).click();
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
test("lists a submitted request assigned to the Coordinator", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "List Coordinator");
    ids.push(coordinator.id);
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "List Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Assigned List ${randomUUID()}`;
    await database.insert(schema.eventRequests).values({
      organiserId,
      eventName,
      status: "submitted",
      submittedAt: new Date(),
      assignedCoordinatorId: coordinator.id,
      assignedAt: new Date(),
    });

    await page.goto("/coordination");
    await expect(page.getByRole("heading", { name: "Assigned to you" })).toBeVisible();
    await expect(page.getByRole("link", { name: eventName })).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("shows every organiser-supplied field on an assigned request", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Detail Coordinator");
    ids.push(coordinator.id);
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Detail Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Full Detail ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        purpose: "Quarterly town hall",
        description: "All-staff briefing with Q&A",
        eventType: "Town hall",
        expectedAttendance: 150,
        venueRequirements: "Auditorium with stage",
        roomLayoutPreference: "Theatre",
        accessibilityRequirements: "Wheelchair-accessible seating",
        specialArrangements: "Live captioning",
        equipmentRequirements: [{ type: "Projector", quantity: 2 }],
        registrationEnabled: true,
        registrationCapacity: 150,
        registrationOpensAt: "2024-05-01T09:00",
        registrationClosesAt: "2024-05-10T17:00",
      })
      .returning();

    await page.goto(`/coordination/${request.id}`);
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(page.getByText("Quarterly town hall")).toBeVisible();
    await expect(page.getByText("All-staff briefing with Q&A")).toBeVisible();
    await expect(page.getByText("Town hall")).toBeVisible();
    await expect(page.getByText("150", { exact: false })).toBeVisible();
    await expect(page.getByText("Auditorium with stage")).toBeVisible();
    await expect(page.getByText("Theatre")).toBeVisible();
    await expect(page.getByText("Wheelchair-accessible seating")).toBeVisible();
    await expect(page.getByText("Live captioning")).toBeVisible();
    await expect(page.getByText(/Projector/)).toBeVisible();
    await expect(page.getByText(/Capacity 150/)).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("takes an assigned request up for review", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Review Coordinator");
    ids.push(coordinator.id);
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Review Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Take Up ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
      })
      .returning();

    await page.goto(`/coordination/${request.id}`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Take up for review" }).click();
    await expect(page).toHaveURL(/\/coordination\/?$/);

    const [stored] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, request.id));
    expect(stored.status).toBe("under_review");
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("hides the take-up-for-review action once already under review", async ({ page }) => {
  const ids: string[] = [];
  try {
    const coordinator = await register(page, "event_coordinator", "Already Reviewing Coordinator");
    ids.push(coordinator.id);
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Already Reviewing Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Already Reviewing ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        eventName,
        status: "under_review",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
      })
      .returning();

    await page.goto(`/coordination/${request.id}`);
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take up for review" })).toHaveCount(0);
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
  }
});

test("does not list or expose another Coordinator's assigned request", async ({
  page,
  browser,
  baseURL,
}) => {
  const otherContext = await browser.newContext({ baseURL });
  const otherPage = await otherContext.newPage();
  const ids: string[] = [];
  try {
    const viewer = await register(page, "event_coordinator", "Excluded Viewer");
    ids.push(viewer.id);
    const owner = await register(otherPage, "event_coordinator", "Excluded Owner");
    ids.push(owner.id);
    const organiserId = randomUUID();
    ids.push(organiserId);
    await database.insert(schema.user).values({
      id: organiserId,
      name: "Excluded Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const eventName = `Owned By Other ${randomUUID()}`;
    const [request] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        eventName,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: owner.id,
        assignedAt: new Date(),
      })
      .returning();

    await page.goto("/coordination");
    await expect(page.getByRole("link", { name: eventName })).toHaveCount(0);

    await page.goto(`/coordination/${request.id}`);
    await expect(
      page.getByText(
        "You no longer have coordination access to this request, or it is unavailable."
      )
    ).toBeVisible();
  } finally {
    await database.delete(schema.user).where(inArray(schema.user.id, ids));
    await otherContext.close();
  }
});
