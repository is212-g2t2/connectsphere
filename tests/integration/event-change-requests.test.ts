// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleGetCoordinationRequest } from "#/features/coordination/assignments.server";
import {
  handleGetEventRequest,
  handleListUnassignedEventRequests,
} from "#/features/event-requests/drafts.server";
import { handleRaiseEventChangeRequest } from "#/features/event-requests/change-requests.server";
import type { EventRequestStatus } from "#/features/event-requests/schema";

const organiser: SessionUser = {
  id: "ptr-51-organiser",
  email: "ptr-51-organiser@example.com",
  role: "event_organiser",
};
const otherOrganiser: SessionUser = {
  id: "ptr-51-other-organiser",
  email: "ptr-51-other@example.com",
  role: "event_organiser",
};
const coordinator: SessionUser = {
  id: "ptr-51-coordinator",
  email: "ptr-51-coordinator@example.com",
  role: "event_coordinator",
};
const userIds = [organiser.id, otherOrganiser.id, coordinator.id];

describe("event change requests (PTR-51)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database
      .insert(schema.user)
      .values([
        {
          id: organiser.id,
          name: "PTR-51 Organiser",
          email: "ptr-51-organiser@example.com",
          emailVerified: true,
          role: "event_organiser",
        },
        {
          id: otherOrganiser.id,
          name: "Other Organiser",
          email: "ptr-51-other@example.com",
          emailVerified: true,
          role: "event_organiser",
        },
        {
          id: coordinator.id,
          name: "PTR-51 Coordinator",
          email: "ptr-51-coordinator@example.com",
          emailVerified: true,
          role: "event_coordinator",
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [organiser.id, otherOrganiser.id]));
  });

  async function createEvent(
    status: EventRequestStatus = "submitted",
    assignedCoordinatorId: string | null = coordinator.id
  ) {
    const decided = ["approved", "rejected", "planning", "confirmed", "completed"].includes(status);
    const confirmed = status === "confirmed";
    const completed = status === "completed";
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        eventName: `${status} workshop`,
        status,
        submittedAt: status === "draft" ? null : new Date("2026-10-01T00:00:00Z"),
        assignedCoordinatorId: status === "draft" ? null : assignedCoordinatorId,
        assignedAt:
          status === "draft" || assignedCoordinatorId === null
            ? null
            : new Date("2026-10-01T00:00:00Z"),
        decisionReason: status === "rejected" ? "Not feasible" : null,
        decidedByCoordinatorId: decided ? coordinator.id : null,
        decidedByCoordinatorName: decided ? "PTR-51 Coordinator" : null,
        decidedAt: decided ? new Date("2026-10-02T00:00:00Z") : null,
        confirmedById: confirmed ? coordinator.id : null,
        confirmedByName: confirmed ? "PTR-51 Coordinator" : null,
        confirmedAt: confirmed ? new Date("2026-10-03T00:00:00Z") : null,
        completedById: completed ? coordinator.id : null,
        completedByName: completed ? "PTR-51 Coordinator" : null,
        completedAt: completed ? new Date("2026-10-04T00:00:00Z") : null,
      })
      .returning();
    return event;
  }

  it.each([
    "submitted",
    "under_review",
    "awaiting_organiser",
    "approved",
    "rejected",
    "planning",
    "confirmed",
  ] satisfies EventRequestStatus[])("records a request while the event is %s", async status => {
    const event = await createEvent(status);

    const change = await handleRaiseEventChangeRequest(
      {
        id: event.id,
        whatShouldChange: "  Proposed date  ",
        requestedValue: "  18 November at 10:00  ",
      },
      organiser,
      database as never
    );

    expect(change).toMatchObject({
      eventRequestId: event.id,
      organiserId: organiser.id,
      whatShouldChange: "Proposed date",
      requestedValue: "18 November at 10:00",
    });
  });

  it("does not change the recorded event and shows the request to both parties (AC1, AC2, AC4)", async () => {
    const event = await createEvent();
    const before = (
      await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, event.id))
    )[0];

    await handleRaiseEventChangeRequest(
      {
        id: event.id,
        whatShouldChange: "Expected attendance",
        requestedValue: "80 attendees",
      },
      organiser,
      database as never
    );

    const after = (
      await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, event.id))
    )[0];
    expect(after).toEqual(before);

    const organiserView = await handleGetEventRequest(
      { id: event.id },
      organiser,
      database as never
    );
    const coordinatorView = await handleGetCoordinationRequest(
      { id: event.id },
      coordinator,
      database as never
    );
    expect(organiserView?.changeRequests).toHaveLength(1);
    expect(coordinatorView.changeRequests).toHaveLength(1);
    expect(coordinatorView.changeRequests[0]).toMatchObject({
      whatShouldChange: "Expected attendance",
      requestedValue: "80 attendees",
    });
  });

  it("lists multiple requests in the order the Organiser raised them", async () => {
    const event = await createEvent();

    await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Date", requestedValue: "18 November" },
      organiser,
      database as never
    );
    await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Venue", requestedValue: "Harbour Hall" },
      organiser,
      database as never
    );

    const view = await handleGetEventRequest({ id: event.id }, organiser, database as never);
    expect(view?.changeRequests.map(item => item.whatShouldChange)).toEqual(["Date", "Venue"]);
  });

  it.each(["draft", "completed", "cancelled"] satisfies EventRequestStatus[])(
    "refuses a request while the event is %s (AC3)",
    async status => {
      const event = await createEvent(status);
      await expect(
        handleRaiseEventChangeRequest(
          { id: event.id, whatShouldChange: "Date", requestedValue: "Tomorrow" },
          organiser,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });
    }
  );

  it("refuses an organiser who does not own the event", async () => {
    const event = await createEvent();
    await expect(
      handleRaiseEventChangeRequest(
        { id: event.id, whatShouldChange: "Date", requestedValue: "Tomorrow" },
        otherOrganiser,
        database as never
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("queues one notification for the assigned Coordinator (AC5)", async () => {
    const event = await createEvent();
    await database
      .update(schema.eventRequests)
      .set({ eventName: "  submitted workshop  " })
      .where(eq(schema.eventRequests.id, event.id));
    await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Venue", requestedValue: "Harbour Hall" },
      organiser,
      database as never
    );

    const rows = await database
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, event.id),
          eq(schema.notifications.recipientId, coordinator.id),
          eq(schema.notifications.kind, "event_change_requested")
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({
      eventName: "submitted workshop",
      whatShouldChange: "Venue",
      requestedValue: "Harbour Hall",
    });
  });

  it("waits for a concurrent completion and then refuses the stale request", async () => {
    const event = await createEvent();
    const gate = new Pool({ connectionString: process.env.DATABASE_URL });
    const gateClient = await gate.connect();
    let raising: ReturnType<typeof handleRaiseEventChangeRequest> | undefined;

    try {
      await gateClient.query("BEGIN");
      await gateClient.query(
        `UPDATE event_requests
         SET status = 'completed',
             decided_by_coordinator_id = $2,
             decided_by_coordinator_name = $3,
             decided_at = $4,
             completed_by_id = $2,
             completed_by_name = $3,
             completed_at = $4
         WHERE id = $1`,
        [event.id, coordinator.id, "PTR-51 Coordinator", new Date("2026-10-02T00:00:00Z")]
      );
      const { rows: gateRows } = await gateClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid"
      );
      const gatePid = gateRows[0].pid;

      raising = handleRaiseEventChangeRequest(
        { id: event.id, whatShouldChange: "Date", requestedValue: "Tomorrow" },
        organiser,
        database as never
      );

      await vi.waitFor(
        async () => {
          const waiting = await database.execute<{ count: string }>(
            sql`SELECT count(*)::text AS count FROM pg_stat_activity
                WHERE wait_event_type = 'Lock'
                  AND query ILIKE '%event_requests%'
                  AND query ILIKE '%for update%'
                  AND ${gatePid}::int = ANY(pg_blocking_pids(pid))`
          );
          expect(Number(waiting.rows[0].count)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 10_000, interval: 25 }
      );

      await gateClient.query("COMMIT");
      await expect(raising).rejects.toMatchObject({ status: 409 });
      const recorded = await database
        .select()
        .from(schema.eventChangeRequests)
        .where(eq(schema.eventChangeRequests.eventRequestId, event.id));
      expect(recorded).toHaveLength(0);
    } finally {
      await gateClient.query("ROLLBACK").catch(() => {});
      await raising?.catch(() => {});
      gateClient.release();
      await gate.end();
    }
  });

  it("keeps an unassigned event in the unassigned list and queues no notification (AC5)", async () => {
    const event = await createEvent("submitted", null);
    await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Venue", requestedValue: "Harbour Hall" },
      organiser,
      database as never
    );

    const unassigned = await handleListUnassignedEventRequests(database as never);
    expect(unassigned.map(item => item.id)).toContain(event.id);
    const notifications = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, event.id));
    expect(notifications).toHaveLength(0);
  });
});
