// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { handleListCoordinatorOversight } from "#/features/coordination/assignments.server";

const users = {
  organiser: {
    id: "oversight-organiser",
    name: "Oversight Organiser",
    email: "oversight-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "oversight-coordinator",
    name: "Oversight Alpha",
    email: "oversight-alpha@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  idleCoordinator: {
    id: "oversight-idle-coordinator",
    name: "Oversight Bravo",
    email: "oversight-bravo@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  lead: {
    id: "oversight-lead",
    name: "Oversight Lead",
    email: "oversight-lead@example.invalid",
    emailVerified: true,
    role: "event_coordinator_lead",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

describe("coordinator oversight (PTR-149)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(user => user.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
  });

  it("lists every Coordinator with every assigned event and excludes drafts and other roles", async () => {
    const activeStatuses = ["submitted", "under_review", "awaiting_organiser"] as const;
    await database.insert(schema.eventRequests).values([
      ...activeStatuses.map((status, index) => ({
        organiserId: users.organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(`2026-09-0${index + 1}T00:00:00Z`),
        eventName: `Oversight ${status}`,
      })),
      // A closed event stays in the record. Rejection needs its decision audit fields.
      {
        organiserId: users.organiser.id,
        status: "rejected" as const,
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date("2026-09-04T00:00:00Z"),
        eventName: "Oversight rejected",
        decisionReason: "The date cannot be supported.",
        decidedByCoordinatorId: users.coordinator.id,
        decidedByCoordinatorName: users.coordinator.name,
        decidedAt: new Date("2026-09-05T00:00:00Z"),
      },
      {
        organiserId: users.organiser.id,
        status: "draft" as const,
        eventName: "Oversight draft",
      },
      // A Lead's own assignment never makes them a Coordinator in the oversight list.
      {
        organiserId: users.organiser.id,
        status: "submitted" as const,
        submittedAt: new Date(),
        assignedCoordinatorId: users.lead.id,
        assignedAt: new Date(),
        eventName: "Oversight lead event",
      },
    ]);

    const oversight = await handleListCoordinatorOversight(database as never);
    const coordinator = oversight.find(row => row.id === users.coordinator.id);
    const idleCoordinator = oversight.find(row => row.id === users.idleCoordinator.id);

    expect(coordinator?.name).toBe(users.coordinator.name);
    expect(coordinator?.events.map(event => event.eventName).toSorted()).toEqual(
      [...activeStatuses.map(status => `Oversight ${status}`), "Oversight rejected"].toSorted()
    );
    // Assigned work only: the draft has no assignment and stays out.
    expect(coordinator?.events.map(event => event.status)).not.toContain("draft");
    // Every Coordinator appears even when they hold nothing.
    expect(idleCoordinator).toEqual({
      id: users.idleCoordinator.id,
      name: users.idleCoordinator.name,
      email: users.idleCoordinator.email,
      events: [],
    });
    expect(oversight.some(row => row.id === users.lead.id)).toBe(false);
    expect(oversight.some(row => row.id === users.organiser.id)).toBe(false);
  });
});
