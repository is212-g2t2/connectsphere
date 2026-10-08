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
  handleSearchVipAttendees,
} from "#/features/events/register.server";
import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  NOT_A_VIP_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
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
const attendees = Array.from({ length: 12 }, (_, index) =>
  actor(`vip-attendee-${String(index).padStart(2, "0")}`, "attendee")
);
const [guest, secondGuest, thirdGuest, fourthGuest, fifthGuest, sixthGuest] = attendees;
/** The Attendees who only take normal places, kept apart from the six a test names. */
const placeTakers = attendees.slice(6);
const users = [organiser, otherOrganiser, coordinator, otherCoordinator, ...attendees];

/** A 4-seat venue, so the ceiling is reached in a few rows, a 2-seat one, and a 10-seat one. */
const VENUE_NAME = "VIP Test Room";
const VENUE_CAPACITY = 4;
const SMALL_VENUE_NAME = "VIP Test Booth";
const SMALL_VENUE_CAPACITY = 2;
const HALL_NAME = "VIP Test Hall";
const VENUE_NAMES = [VENUE_NAME, SMALL_VENUE_NAME, HALL_NAME];

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
  let smallVenueId: number;
  let hallId: number;
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
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));
    const [venue, smallVenue, hall] = await database
      .insert(schema.venues)
      .values([
        {
          name: VENUE_NAME,
          location: "Level 5",
          maxCapacity: VENUE_CAPACITY,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: SMALL_VENUE_NAME,
          location: "Level 6",
          maxCapacity: SMALL_VENUE_CAPACITY,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: HALL_NAME,
          location: "Level 7",
          maxCapacity: 10,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
      ])
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    smallVenueId = smallVenue.id;
    hallId = hall.id;
  });

  afterAll(async () => {
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));
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
    // Registrations, the change log and notifications cascade with the event.
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  /**
   * A confirmed event with registration on, assigned to `coordinator`, booked at the 4-seat room.
   * Its expected attendance is apart from both capacities, so no test can pass on it by accident.
   */
  async function createEvent(
    options: {
      status?: "approved" | "confirmed";
      registration?: boolean;
      capacity?: number;
      booked?: boolean;
      venue?: number;
      window?: { opensAt: string; closesAt: string };
    } = {}
  ) {
    const status = options.status ?? "confirmed";
    const registration = options.registration ?? true;
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
        expectedAttendance: 50,
        eventType: "Gala",
        registrationEnabled: registration,
        ...(registration
          ? {
              registrationCapacity: options.capacity ?? 2,
              registrationOpensAt: options.window?.opensAt ?? "2026-11-01T09:00",
              registrationClosesAt: options.window?.closesAt ?? "2026-12-01T17:00",
            }
          : {}),
      })
      .returning({ id: schema.eventRequests.id, eventName: schema.eventRequests.eventName });
    created.push(row.id);

    if (options.booked ?? true) {
      // A distant year per booking keeps the overlap constraint from tripping.
      bookingYear += 1;
      await database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId: row.id,
        venueId: options.venue ?? venueId,
        requestedById: coordinator.id,
        startsAt: `${bookingYear}-12-05 10:00:00`,
        endsAt: `${bookingYear}-12-05 16:00:00`,
        status: "approved",
      });
    }
    return row;
  }

  const addVip = (eventId: number, attendee: SessionUser, as: SessionUser = organiser) =>
    handleAddVipRegistration({ id: eventId, attendeeId: attendee.id }, as, database as never);

  const removeVip = (eventId: number, attendee: SessionUser, as: SessionUser = organiser) =>
    handleRemoveVipRegistration({ id: eventId, attendeeId: attendee.id }, as, database as never);

  const search = (eventId: number, query: string, as: SessionUser = organiser) =>
    handleSearchVipAttendees({ id: eventId, query }, as, database as never);

  const register = (eventId: number, as: SessionUser) =>
    handleRegisterForEvent({ id: eventId }, as, database as never, insidePeriod);

  /** Normal registrations written directly: only the counting is under test where this is used. */
  const fillNormal = (eventId: number, takers: SessionUser[]) =>
    database
      .insert(schema.eventRegistrations)
      .values(takers.map(taker => ({ eventId, attendeeId: taker.id })));

  const registrationOf = async (eventId: number, attendee: SessionUser) =>
    (
      await database
        .select()
        .from(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, eventId),
            eq(schema.eventRegistrations.attendeeId, attendee.id)
          )
        )
    ).at(0);

  /** The change log for one Attendee, oldest first. */
  const changesFor = async (eventId: number, attendee: SessionUser) =>
    database
      .select()
      .from(schema.vipRegistrationChanges)
      .where(
        and(
          eq(schema.vipRegistrationChanges.eventId, eventId),
          eq(schema.vipRegistrationChanges.attendeeId, attendee.id)
        )
      )
      .orderBy(schema.vipRegistrationChanges.id);

  const thresholdNotices = (eventId: number) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, eventId),
          eq(schema.notifications.kind, "registration_threshold_reached")
        )
      );

  // ── AC1, AC5 ───────────────────────────────────────────────────────────────────────────────
  test("records a VIP registration against the event, and logs who added it and when", async () => {
    const event = await createEvent();
    const before = Date.now();

    await addVip(event.id, guest);

    expect(await registrationOf(event.id, guest)).toMatchObject({
      status: "registered",
      vip: true,
    });
    const [change] = await changesFor(event.id, guest);
    expect(change).toMatchObject({ change: "added", actorId: organiser.id });
    expect(change.changedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  test("ignores the registration period: a VIP is added after it closes", async () => {
    const event = await createEvent({
      window: { opensAt: "2020-01-01T00:00", closesAt: "2020-02-01T00:00" },
    });

    await addVip(event.id, guest);

    expect(await registrationOf(event.id, guest)).toMatchObject({ vip: true });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  test("accepts a VIP when normal registration is full, without taking a normal place", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [thirdGuest, fourthGuest]);

    await addVip(event.id, guest);

    expect(await registrationOf(event.id, guest)).toMatchObject({
      status: "registered",
      vip: true,
    });
    // Normal registration is still full at its own capacity.
    expect(await conflict(register(event.id, secondGuest))).toBe(EVENT_FULL_MESSAGE);
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────────────────────
  test("refuses a VIP once normal and VIP registrations fill the venue, and names it", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [fifthGuest, sixthGuest]);
    await addVip(event.id, guest);
    await addVip(event.id, secondGuest);

    expect(await conflict(addVip(event.id, thirdGuest))).toBe(
      venueCapacityReachedMessage(VENUE_CAPACITY)
    );
    expect(await registrationOf(event.id, thirdGuest)).toBeUndefined();
  });

  test("counts the VIPs against the venue for a normal registration too (PTR-45 AC5)", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [fifthGuest]);
    await addVip(event.id, guest);
    await addVip(event.id, secondGuest);
    await addVip(event.id, thirdGuest);

    expect(await conflict(register(event.id, fourthGuest))).toBe(
      venueCapacityReachedMessage(VENUE_CAPACITY)
    );
  });

  test("holds a VIP to the venue of an amended booking", async () => {
    const event = await createEvent();
    await fillNormal(event.id, [fifthGuest]);
    await database
      .update(schema.venueRequests)
      .set({ venueId: smallVenueId })
      .where(eq(schema.venueRequests.eventId, event.id));

    await addVip(event.id, guest);

    expect(await conflict(addVip(event.id, secondGuest))).toBe(
      venueCapacityReachedMessage(SMALL_VENUE_CAPACITY)
    );
  });

  test("makes a VIP for the venue's last place wait for the registration ahead of it, then refuses it", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [fifthGuest, sixthGuest, thirdGuest]);
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

      adding = addVip(event.id, guest).catch((caught: unknown) => caught);
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
    expect(await registrationOf(event.id, guest)).toBeUndefined();
  });

  // ── AC6 ────────────────────────────────────────────────────────────────────────────────────
  test("removes a VIP: it frees its venue place, and the log keeps who removed it and when", async () => {
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [fifthGuest, sixthGuest]);
    await addVip(event.id, guest);
    await addVip(event.id, secondGuest);

    await removeVip(event.id, guest, coordinator);

    expect(await registrationOf(event.id, guest)).toMatchObject({ status: "withdrawn" });
    expect(await changesFor(event.id, guest)).toEqual([
      expect.objectContaining({ change: "added", actorId: organiser.id }),
      expect.objectContaining({ change: "removed", actorId: coordinator.id }),
    ]);
    // The venue was full; the freed place takes another VIP.
    await addVip(event.id, thirdGuest);
    expect(await registrationOf(event.id, thirdGuest)).toMatchObject({ status: "registered" });
  });

  test("refuses to remove a VIP registration twice, or an Attendee's own registration", async () => {
    const event = await createEvent();
    await addVip(event.id, guest);
    await removeVip(event.id, guest);
    await fillNormal(event.id, [secondGuest]);

    expect(await conflict(removeVip(event.id, guest))).toBe(NOT_A_VIP_MESSAGE);
    expect(await conflict(removeVip(event.id, secondGuest))).toBe(NOT_A_VIP_MESSAGE);
    expect(await registrationOf(event.id, secondGuest)).toMatchObject({
      status: "registered",
      vip: false,
    });
    expect(await changesFor(event.id, guest)).toHaveLength(2);
  });

  test("keeps the whole log when a removed VIP is added again", async () => {
    const event = await createEvent();
    await addVip(event.id, guest);
    await removeVip(event.id, guest, coordinator);

    await addVip(event.id, guest, coordinator);

    expect(await registrationOf(event.id, guest)).toMatchObject({
      status: "registered",
      vip: true,
    });
    expect((await changesFor(event.id, guest)).map(row => [row.change, row.actorId])).toEqual([
      ["added", organiser.id],
      ["removed", coordinator.id],
      ["added", coordinator.id],
    ]);
  });

  test("lets a removed VIP register as a normal Attendee, and keeps the log", async () => {
    const event = await createEvent();
    await addVip(event.id, guest);
    await removeVip(event.id, guest);

    await register(event.id, guest);

    expect(await registrationOf(event.id, guest)).toMatchObject({
      status: "registered",
      vip: false,
    });
    expect(await changesFor(event.id, guest)).toHaveLength(2);
  });

  // ── Refusals ───────────────────────────────────────────────────────────────────────────────
  test("refuses an Attendee who already holds a registration of either kind", async () => {
    const event = await createEvent();
    await fillNormal(event.id, [guest]);
    await addVip(event.id, secondGuest);

    expect(await conflict(addVip(event.id, guest))).toBe(VIP_ALREADY_REGISTERED_MESSAGE);
    expect(await conflict(addVip(event.id, secondGuest))).toBe(VIP_ALREADY_REGISTERED_MESSAGE);
    // And a VIP cannot take a normal place on top.
    expect(await conflict(register(event.id, secondGuest))).toBe(ALREADY_REGISTERED_MESSAGE);
  });

  test("refuses an account that is not an Attendee's, or that does not exist", async () => {
    const event = await createEvent();

    for (const account of [otherOrganiser, actor("vip-nobody", "attendee")]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one refusal at a time
      const error = await addVip(event.id, account).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as Error).message).toBe(VIP_NOT_ATTENDEE_MESSAGE);
    }
  });

  test.each([
    ["another Organiser", otherOrganiser],
    ["an unassigned Coordinator", otherCoordinator],
  ])("refuses %s as if the event did not exist", async (_, caller) => {
    const event = await createEvent();
    await addVip(event.id, guest);

    await expect(addVip(event.id, secondGuest, caller)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(removeVip(event.id, guest, caller)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(search(event.id, "vip-", caller)).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("refuses an event id that does not exist the same way", async () => {
    await expect(addVip(2_000_000_000, guest)).rejects.toThrow("Forbidden");
  });

  test.each([
    ["not yet confirmed", { status: "approved" as const }],
    ["confirmed with registration off", { registration: false }],
  ])("refuses an event that is %s", async (_, options) => {
    const event = await createEvent(options);

    expect(await conflict(addVip(event.id, guest))).toBe(VIPS_CLOSED_MESSAGE);
    expect(await conflict(search(event.id, "vip-"))).toBe(VIPS_CLOSED_MESSAGE);
  });

  test("refuses a new VIP once the approved booking is released, but still lets one be removed", async () => {
    const event = await createEvent();
    await addVip(event.id, guest);
    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Maintenance" })
      .where(eq(schema.venueRequests.eventId, event.id));

    expect(await conflict(addVip(event.id, secondGuest))).toBe(REGISTRATION_NOT_OPEN_MESSAGE);
    await removeVip(event.id, guest);
    expect(await registrationOf(event.id, guest)).toMatchObject({ status: "withdrawn" });
  });

  // ── The search the VIP is chosen from ──────────────────────────────────────────────────────
  test("finds Attendees by part of the name or the email, whatever the case", async () => {
    const event = await createEvent();

    expect(await search(event.id, "VIP-ATTENDEE-01 NAME")).toEqual([
      { attendeeId: secondGuest.id, name: secondGuest.name, email: secondGuest.email },
    ]);
    // A pasted tab is a space.
    expect(
      (await search(event.id, "vip-attendee-00\tname")).map(found => found.attendeeId)
    ).toEqual([guest.id]);
    // The assigned Coordinator searches the same way.
    expect(
      (await search(event.id, "attendee-02@X.TEST", coordinator)).map(found => found.attendeeId)
    ).toEqual([thirdGuest.id]);
  });

  test("puts the account with exactly the typed email first, ahead of accounts named after it", async () => {
    const event = await createEvent();
    const decoys = Array.from({ length: 10 }, (_, index) => ({
      id: `decoy-${index}`,
      name: `A ${guest.email} ${index}`,
      email: `decoy-${index}@x.test`,
      emailVerified: false,
      role: "attendee",
    }));
    await database.insert(schema.user).values(decoys);
    try {
      const found = await search(event.id, guest.email.toUpperCase());

      expect(found).toHaveLength(10);
      expect(found[0].attendeeId).toBe(guest.id);
    } finally {
      await database.delete(schema.user).where(
        inArray(
          schema.user.id,
          decoys.map(decoy => decoy.id)
        )
      );
    }
  });

  test("finds and adds an Attendee who has not verified the email", async () => {
    const event = await createEvent();
    const unverified = actor("unverified-guest", "attendee");
    await database.insert(schema.user).values({
      id: unverified.id,
      name: "Unverified Guest",
      email: unverified.email,
      emailVerified: false,
      role: "attendee",
    });
    try {
      expect((await search(event.id, "unverified-guest")).map(found => found.attendeeId)).toEqual([
        unverified.id,
      ]);
      await addVip(event.id, unverified);
      expect(await registrationOf(event.id, unverified)).toMatchObject({ vip: true });
    } finally {
      await database.delete(schema.user).where(eq(schema.user.id, unverified.id));
    }
  });

  test("leaves out other roles and Attendees who already hold a registration", async () => {
    const event = await createEvent();
    await fillNormal(event.id, [guest]);
    await addVip(event.id, secondGuest);
    await addVip(event.id, thirdGuest);
    await removeVip(event.id, thirdGuest);

    const found = (await search(event.id, "vip-")).map(account => account.attendeeId);

    // A removed VIP holds no registration, so it can be found and added again. Ten at most.
    expect(found).toEqual([
      thirdGuest.id,
      fourthGuest.id,
      fifthGuest.id,
      sixthGuest.id,
      ...placeTakers.map(taker => taker.id),
    ]);
  });

  test("matches a typed % or _ only as itself", async () => {
    const event = await createEvent();

    expect(await search(event.id, "%%")).toEqual([]);
    expect(await search(event.id, "__")).toEqual([]);
  });

  // ── AC4 and the place limit ────────────────────────────────────────────────────────────────
  test("shows the Organiser and the Coordinator the VIPs apart, and the Attendee the places they leave", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [fifthGuest]);
    await addVip(event.id, guest);
    await addVip(event.id, secondGuest);
    await removeVip(event.id, secondGuest);
    await addVip(event.id, thirdGuest);

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
      sixthGuest,
      database as never
    );
    expect(attendeeView.event.places).toEqual({ registered: 1, vip: 2, limit: 2, capacity: 4 });
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
    await addVip(event.id, guest);
    await addVip(event.id, secondGuest);
    await fillNormal(event.id, [fifthGuest]);

    await register(event.id, sixthGuest);

    const notices = await thresholdNotices(event.id);
    expect(notices.map(notice => notice.payload)).toEqual([
      expect.objectContaining({ registered: 2, limit: 2 }),
      expect.objectContaining({ registered: 2, limit: 2 }),
    ]);
  });

  test("tells the Organiser and the Coordinator when a VIP takes normal registration's last place", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [fifthGuest, sixthGuest]);

    // 2 normal registrations against min(4, 4 − 1) = 3 places: not yet at a mark.
    await addVip(event.id, guest);
    expect(await thresholdNotices(event.id)).toEqual([]);

    // Against min(4, 4 − 2) = 2 places, the 2 normal registrations fill it.
    await addVip(event.id, secondGuest);
    const notices = await thresholdNotices(event.id);
    expect(
      notices.map(notice => ({ recipientId: notice.recipientId, payload: notice.payload }))
    ).toEqual(
      expect.arrayContaining([
        {
          recipientId: organiser.id,
          payload: { eventName: event.eventName, registered: 2, limit: 2, audience: "organiser" },
        },
        {
          recipientId: coordinator.id,
          payload: {
            eventName: event.eventName,
            registered: 2,
            limit: 2,
            audience: "coordinator",
          },
        },
      ])
    );
    expect(notices).toHaveLength(2);
  });

  test("tells the full mark when a VIP moves the count onto it from the 90% mark", async () => {
    // 9 normal registrations at a 10-seat venue are 90% of a limit of 10; a VIP makes the limit 9.
    const event = await createEvent({ capacity: 10, venue: hallId });
    await fillNormal(event.id, [...attendees.slice(1, 6), ...placeTakers.slice(0, 4)]);

    await addVip(event.id, guest);

    expect((await thresholdNotices(event.id)).map(notice => notice.payload)).toEqual([
      expect.objectContaining({ registered: 9, limit: 9 }),
      expect.objectContaining({ registered: 9, limit: 9 }),
    ]);
  });

  test("tells nothing when a VIP leaves the limit where it was", async () => {
    // The registration capacity of 2 binds, so a VIP at the 4-seat venue does not move the limit.
    const event = await createEvent({ capacity: 2 });
    await fillNormal(event.id, [fifthGuest, sixthGuest]);

    await addVip(event.id, guest);

    expect(await thresholdNotices(event.id)).toEqual([]);
  });

  test("tells each mark once, however often a VIP is removed and added again", async () => {
    const event = await createEvent({ capacity: 4 });
    await fillNormal(event.id, [fifthGuest, sixthGuest]);
    await addVip(event.id, guest);

    for (let round = 0; round < 3; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the rounds run in order
      await addVip(event.id, secondGuest);
      // oxlint-disable-next-line eslint/no-await-in-loop -- the rounds run in order
      await removeVip(event.id, secondGuest);
    }

    expect(await thresholdNotices(event.id)).toHaveLength(2);
  });
});
