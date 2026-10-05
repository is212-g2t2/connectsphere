// Mirrors event-registration.test.ts: a local node-postgres drizzle instance, not the app's `#/db`.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import {
  handleAddVipRegistration,
  handleRegisterForEvent,
  handleRemoveVipRegistration,
} from "#/features/events/register.server";
import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_ALREADY_REMOVED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  venueCapacityReachedMessage,
} from "#/features/events/registration";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string): SessionUser => ({
  id,
  role,
  name: `${id} name`,
  email: `${id}@x.test`,
});

const organiser = actor("vip-organiser", "event_organiser");
const otherOrganiser = actor("vip-other-organiser", "event_organiser");
const coordinator = actor("vip-coordinator", "event_coordinator");
const otherCoordinator = actor("vip-other-coordinator", "event_coordinator");
const attendees = Array.from({ length: 6 }, (_, index) =>
  actor(`vip-attendee-${index}`, "attendee")
);
const [guest, secondGuest, thirdGuest, fourthGuest] = attendees;
const users = [organiser, otherOrganiser, coordinator, otherCoordinator, ...attendees];

/** A 4-seat venue, so the ceiling is reached in a few rows. */
const VENUE_NAME = "VIP Test Room";
const VENUE_CAPACITY = 4;

/** Inside the event's registration period. */
const insidePeriod = new Date("2026-11-15T04:00:00Z");

async function conflict(attempt: Promise<unknown>) {
  const error = await attempt.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictError);
  return (error as Error).message;
}

describe("VIP registrations (PTR-111)", () => {
  let pool: Pool;
  let database: Database;
  let venueId: number;
  let bookingYear = 2150;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    await database
      .insert(schema.user)
      .values(
        users.map(user => ({
          id: user.id,
          name: user.name ?? user.id,
          email: user.email,
          emailVerified: true,
          role: user.role ?? undefined,
        }))
      )
      .onConflictDoNothing();
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "Level 5",
        maxCapacity: VENUE_CAPACITY,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
  });

  afterAll(async () => {
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        users.map(user => user.id)
      )
    );
    await pool.end();
  });

  afterEach(async () => {
    if (created.length === 0) return;
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  /** A confirmed event with registration on, assigned to `coordinator`, booked at the room. */
  async function createEvent(
    options: {
      status?: "approved" | "confirmed";
      capacity?: number;
      booked?: boolean;
      window?: { opensAt: string; closesAt: string };
    } = {}
  ) {
    const status = options.status ?? "confirmed";
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: coordinator.id,
        decidedByCoordinatorName: "VIP Coordinator",
        decidedAt: new Date(),
        ...(status === "confirmed"
          ? {
              confirmedById: coordinator.id,
              confirmedByName: "VIP Coordinator",
              confirmedAt: new Date(),
            }
          : {}),
        eventName: `VIP test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T16:00" }],
        expectedAttendance: 4,
        eventType: "Gala",
        registrationEnabled: true,
        registrationCapacity: options.capacity ?? 2,
        registrationOpensAt: options.window?.opensAt ?? "2026-11-01T09:00",
        registrationClosesAt: options.window?.closesAt ?? "2026-12-01T17:00",
      })
      .returning({ id: schema.eventRequests.id, eventName: schema.eventRequests.eventName });
    created.push(row.id);

    if (options.booked ?? true) {
      // A distant year per booking keeps the overlap constraint from tripping.
      bookingYear += 1;
      await database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId: row.id,
        venueId,
        requestedById: coordinator.id,
        startsAt: `${bookingYear}-12-05 10:00:00`,
        endsAt: `${bookingYear}-12-05 16:00:00`,
        status: "approved",
      });
    }
    return row;
  }

  const addVip = (eventId: number, email: string, as: SessionUser = organiser) =>
    handleAddVipRegistration({ id: eventId, email }, as, database as never);

  const removeVip = (eventId: number, attendeeId: string, as: SessionUser = organiser) =>
    handleRemoveVipRegistration({ id: eventId, attendeeId }, as, database as never);

  const register = (eventId: number, as: SessionUser) =>
    handleRegisterForEvent({ id: eventId }, as, database as never, insidePeriod);

  /** Normal registrations written directly: only the counting is under test where this is used. */
  const fillNormal = (eventId: number, takers: SessionUser[]) =>
    database
      .insert(schema.eventRegistrations)
      .values(takers.map(taker => ({ eventId, attendeeId: taker.id })));

  const registrationOf = async (eventId: number, attendeeId: string) =>
    (
      await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, eventId),
            eq(schema.eventRegistrations.attendeeId, attendeeId)
          )
        )
    ).at(0);

  // ── AC1, AC5 ───────────────────────────────────────────────────────────────────────────────
  test("records a VIP registration against the event, with the acting user and the time", async () => {
    const event = await createEvent();
    const before = Date.now();

    const vip = await addVip(event.id, guest.email);

    expect(vip).toEqual({ attendeeId: guest.id, name: guest.name, email: guest.email });
    const row = await registrationOf(event.id, guest.id);
    expect(row).toMatchObject({
      status: "registered",
      vip: true,
      addedById: organiser.id,
      removedById: null,
      removedAt: null,
    });
    expect(row?.registeredAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  test("lets the assigned Coordinator add one, and finds the account whatever the email's case", async () => {
    const event = await createEvent();

    await addVip(event.id, `  ${guest.email.toUpperCase()} `, coordinator);

    expect(await registrationOf(event.id, guest.id)).toMatchObject({
      vip: true,
      addedById: coordinator.id,
    });
  });

  test("ignores the registration period: a VIP is added after it closes", async () => {
    const event = await createEvent({
      window: { opensAt: "2020-01-01T00:00", closesAt: "2020-02-01T00:00" },
    });

    await addVip(event.id, guest.email);

    expect(await registrationOf(event.id, guest.id)).toMatchObject({ vip: true });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  test("accepts a VIP when normal registration is full, without taking a normal place", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [thirdGuest, fourthGuest]);

    await addVip(event.id, guest.email);

    expect(await registrationOf(event.id, guest.id)).toMatchObject({
      status: "registered",
      vip: true,
    });
    // Normal registration is still full at its own capacity.
    expect(await conflict(register(event.id, secondGuest))).toBe(EVENT_FULL_MESSAGE);
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────────────────────
  test("refuses a VIP once normal and VIP registrations fill the venue, and names it", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [attendees[4], attendees[5]]);
    await addVip(event.id, guest.email);
    await addVip(event.id, secondGuest.email);

    expect(await conflict(addVip(event.id, thirdGuest.email))).toBe(
      venueCapacityReachedMessage(VENUE_CAPACITY)
    );
    expect(await registrationOf(event.id, thirdGuest.id)).toBeUndefined();
  });

  test("counts the VIPs against the venue for a normal registration too (PTR-45 AC5)", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [attendees[4]]);
    await addVip(event.id, guest.email);
    await addVip(event.id, secondGuest.email);
    await addVip(event.id, thirdGuest.email);

    expect(await conflict(register(event.id, fourthGuest))).toBe(
      venueCapacityReachedMessage(VENUE_CAPACITY)
    );
  });

  test("makes a VIP for the venue's last place wait for the registration ahead of it, then refuses it", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [attendees[4], attendees[5], thirdGuest]);
    // A second connection plays the Attendee's registration ahead: it holds the event row lock
    // and fills the last venue place, uncommitted. If the VIP handler drops the lock, it counts
    // three places, adds the VIP too, and the venue ends over capacity.
    const client = await pool.connect();
    let adding: Promise<unknown> | undefined;
    try {
      await client.query("begin");
      await client.query("select id from event_requests where id = $1 for no key update", [
        event.id,
      ]);
      const { rows: clientRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      );
      await client.query(
        "insert into event_registrations (event_id, attendee_id) values ($1, $2)",
        [event.id, fourthGuest.id]
      );

      adding = addVip(event.id, guest.email).catch((caught: unknown) => caught);
      await vi.waitFor(
        async () => {
          const { rows } = await pool.query<{ waiting: number }>(
            "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))",
            [clientRows[0].pid]
          );
          expect(rows[0].waiting).toBeGreaterThan(0);
        },
        { timeout: 3_000, interval: 20 }
      );
      await client.query("commit");
    } finally {
      client.release();
    }

    const outcome = await adding;
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((outcome as Error).message).toBe(venueCapacityReachedMessage(VENUE_CAPACITY));
    expect(await registrationOf(event.id, guest.id)).toBeUndefined();
  });

  // ── AC6 ────────────────────────────────────────────────────────────────────────────────────
  test("removes a VIP: it frees its venue place, and the acting user and the time are stored", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [attendees[4], attendees[5]]);
    await addVip(event.id, guest.email);
    await addVip(event.id, secondGuest.email);
    expect(await conflict(addVip(event.id, thirdGuest.email))).toBe(
      venueCapacityReachedMessage(VENUE_CAPACITY)
    );

    const removal = await removeVip(event.id, guest.id, coordinator);

    const row = await registrationOf(event.id, guest.id);
    expect(row).toMatchObject({ status: "withdrawn", vip: true, removedById: coordinator.id });
    expect(row?.removedAt?.toISOString()).toBe(removal.removedAt);
    // The freed place takes another VIP.
    await addVip(event.id, thirdGuest.email);
    expect(await registrationOf(event.id, thirdGuest.id)).toMatchObject({ status: "registered" });
  });

  test("refuses to remove a VIP registration twice, or an Attendee's own registration", async () => {
    const event = await createEvent();
    await addVip(event.id, guest.email);
    await removeVip(event.id, guest.id);
    await fillNormal(event.id, [secondGuest]);

    expect(await conflict(removeVip(event.id, guest.id))).toBe(VIP_ALREADY_REMOVED_MESSAGE);
    expect(await conflict(removeVip(event.id, secondGuest.id))).toBe(VIP_ALREADY_REMOVED_MESSAGE);
    expect(await registrationOf(event.id, secondGuest.id)).toMatchObject({
      status: "registered",
      vip: false,
    });
  });

  test("adds a removed VIP again on the same row, and clears the removal", async () => {
    const event = await createEvent();
    await addVip(event.id, guest.email);
    await removeVip(event.id, guest.id);

    await addVip(event.id, guest.email, coordinator);

    expect(await registrationOf(event.id, guest.id)).toMatchObject({
      status: "registered",
      vip: true,
      addedById: coordinator.id,
      removedById: null,
      removedAt: null,
    });
  });

  test("lets a removed VIP register as a normal Attendee, which clears the VIP record", async () => {
    const event = await createEvent();
    await addVip(event.id, guest.email);
    await removeVip(event.id, guest.id);

    await register(event.id, guest);

    expect(await registrationOf(event.id, guest.id)).toMatchObject({
      status: "registered",
      vip: false,
      addedById: null,
      removedById: null,
      removedAt: null,
    });
  });

  // ── Refusals ───────────────────────────────────────────────────────────────────────────────
  test("refuses an Attendee who already holds a registration of either kind", async () => {
    const event = await createEvent();
    await fillNormal(event.id, [guest]);
    await addVip(event.id, secondGuest.email);

    expect(await conflict(addVip(event.id, guest.email))).toBe(VIP_ALREADY_REGISTERED_MESSAGE);
    expect(await conflict(addVip(event.id, secondGuest.email))).toBe(
      VIP_ALREADY_REGISTERED_MESSAGE
    );
    // And a VIP cannot take a normal place on top.
    expect(await conflict(register(event.id, secondGuest))).toBe(ALREADY_REGISTERED_MESSAGE);
  });

  test("refuses an email that no Attendee account uses", async () => {
    const event = await createEvent();

    for (const email of ["nobody@x.test", otherOrganiser.email]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one refusal at a time
      const error = await addVip(event.id, email).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as Error).message).toBe(VIP_NOT_ATTENDEE_MESSAGE);
    }
  });

  test.each([
    ["another Organiser", otherOrganiser],
    ["an unassigned Coordinator", otherCoordinator],
  ])("refuses %s as if the event did not exist", async (_, caller) => {
    const event = await createEvent();
    await addVip(event.id, guest.email);

    await expect(addVip(event.id, secondGuest.email, caller)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(removeVip(event.id, guest.id, caller)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(addVip(2_000_000_000, secondGuest.email)).rejects.toThrow("Forbidden");
  });

  test("refuses an event that is not yet confirmed", async () => {
    const event = await createEvent({ status: "approved" });

    expect(await conflict(addVip(event.id, guest.email))).toBe(REGISTRATION_NOT_OPEN_MESSAGE);
  });

  test("refuses a new VIP once the approved booking is released, but still lets one be removed", async () => {
    const event = await createEvent();
    await addVip(event.id, guest.email);
    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Maintenance" })
      .where(eq(schema.venueRequests.eventId, event.id));

    expect(await conflict(addVip(event.id, secondGuest.email))).toBe(REGISTRATION_NOT_OPEN_MESSAGE);
    await removeVip(event.id, guest.id);
    expect(await registrationOf(event.id, guest.id)).toMatchObject({ status: "withdrawn" });
  });

  // ── AC4 and the place limit ────────────────────────────────────────────────────────────────
  test("shows the Organiser and the Coordinator the VIPs apart, and the Attendee the places they leave", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [attendees[4]]);
    await addVip(event.id, guest.email);
    await addVip(event.id, secondGuest.email);
    await removeVip(event.id, secondGuest.id);
    await addVip(event.id, thirdGuest.email);

    for (const caller of [organiser, coordinator]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one projection at a time
      const [projection] = await handleListEvents({ eventId: event.id }, caller, database as never);
      expect(projection.event.vipRegistrations).toEqual([
        { attendeeId: guest.id, name: guest.name, email: guest.email },
        { attendeeId: thirdGuest.id, name: thirdGuest.name, email: thirdGuest.email },
      ]);
    }

    // The two VIPs leave two of the four venue places; the one normal registration has taken one.
    const [attendeeView] = await handleListEvents(
      { eventId: event.id },
      attendees[5],
      database as never
    );
    expect(attendeeView.event.places).toEqual({ registered: 1, limit: 2 });
    expect(attendeeView.event).not.toHaveProperty("vipRegistrations");
  });

  test("gives no VIP list for an event that is not published", async () => {
    const event = await createEvent({ status: "approved" });

    const [projection] = await handleListEvents(
      { eventId: event.id },
      organiser,
      database as never
    );

    expect(projection.event.vipRegistrations).toBeNull();
  });

  test("tells the Organiser that registration is full at the places the VIPs leave", async () => {
    const event = await createEvent({ capacity: 4 });
    await addVip(event.id, guest.email);
    await addVip(event.id, secondGuest.email);
    await fillNormal(event.id, [attendees[4]]);

    await register(event.id, attendees[5]);

    const notices = await database
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, event.id),
          eq(schema.notifications.kind, "registration_threshold_reached"),
          eq(schema.notifications.recipientId, organiser.id)
        )
      );
    expect(notices.map(notice => notice.payload)).toEqual([
      expect.objectContaining({ registered: 2, limit: 2 }),
    ]);
  });
});
