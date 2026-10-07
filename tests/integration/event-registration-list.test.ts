// oxlint-disable node/no-process-env
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { AuthorizationError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleListEventRegistrations } from "#/features/events/records.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string): SessionUser => ({
  id,
  role,
  name: id,
  email: `${id}@x.test`,
});

const organiser = actor("registration-list-organiser", "event_organiser");
const coordinator = actor("registration-list-coordinator", "event_coordinator");
const stranger = actor("registration-list-stranger", "attendee");
const unassignedCoordinator = actor("registration-list-unassigned", "event_coordinator");
const anotherOrganiser = actor("registration-list-other-org", "event_organiser");

const [attendee, secondAttendee, thirdAttendee, withdrawnAttendee] = Array.from(
  { length: 4 },
  (_, i) => actor(`registration-list-attendee-${i}`, "attendee")
);

describe("list event registrations (PTR-48)", () => {
  let pool: Pool;
  let database: Database;
  let eventId: number;

  beforeEach(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database
      .delete(schema.user)
      .where(
        inArray(schema.user.id, [
          organiser.id,
          coordinator.id,
          stranger.id,
          unassignedCoordinator.id,
          anotherOrganiser.id,
          attendee.id,
          secondAttendee.id,
          thirdAttendee.id,
          withdrawnAttendee.id,
        ])
      );

    // Seed actors
    await database.insert(schema.user).values(
      [
        organiser,
        coordinator,
        stranger,
        unassignedCoordinator,
        anotherOrganiser,
        attendee,
        secondAttendee,
        thirdAttendee,
        withdrawnAttendee,
      ].map(u => ({
        id: u.id,
        email: u.email,
        name: u.name ?? "",
        role: u.role ?? "attendee",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    // Seed event
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status: "confirmed",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: coordinator.id,
        decidedByCoordinatorName: coordinator.name,
        decidedAt: new Date(),
        confirmedById: coordinator.id,
        confirmedByName: coordinator.name,
        confirmedAt: new Date(),
        eventName: "List Test Event",
        purpose: "test",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T16:00" }],
        expectedAttendance: 10,
        eventType: "Open Day",
        registrationEnabled: true,
        registrationCapacity: 10,
        registrationOpensAt: "2026-11-01T09:00",
        registrationClosesAt: "2026-12-01T17:00",
      })
      .returning();
    eventId = event.id;

    // Seed registrations
    await database.insert(schema.eventRegistrations).values([
      { eventId, attendeeId: attendee.id, status: "registered", vip: false },
      { eventId, attendeeId: secondAttendee.id, status: "registered", vip: false },
      { eventId, attendeeId: thirdAttendee.id, status: "registered", vip: true }, // VIP
      { eventId, attendeeId: withdrawnAttendee.id, status: "withdrawn", vip: false },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  test("AC2: lists active attendees including VIPs, excluding withdrawn, for the Organiser", async () => {
    const list = await handleListEventRegistrations({ id: eventId }, organiser, database as never);
    expect(list).toHaveLength(3);
    expect(list.map(a => a.attendeeId).toSorted()).toEqual(
      [attendee.id, secondAttendee.id, thirdAttendee.id].toSorted()
    );

    const third = list.find(a => a.attendeeId === thirdAttendee.id);
    expect(third?.vip).toBe(true);
    expect(third?.name).toBe(thirdAttendee.name);
  });

  test("AC2: lists active attendees for the assigned Coordinator", async () => {
    const list = await handleListEventRegistrations(
      { id: eventId },
      coordinator,
      database as never
    );
    expect(list).toHaveLength(3);
  });

  test("AC3: refuses access to any other user, including unassigned Coordinator", async () => {
    await expect(
      handleListEventRegistrations({ id: eventId }, unassignedCoordinator, database as never)
    ).rejects.toThrow(AuthorizationError);
    await expect(
      handleListEventRegistrations({ id: eventId }, stranger, database as never)
    ).rejects.toThrow(AuthorizationError);
    await expect(
      handleListEventRegistrations({ id: eventId }, anotherOrganiser, database as never)
    ).rejects.toThrow(AuthorizationError);
  });
});
