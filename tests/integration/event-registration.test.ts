// Mirrors event-confirmation.test.ts: a local node-postgres drizzle instance, not the app's
// `#/db`, with notifications read back from the `notifications` table.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleRegisterForEvent } from "#/features/events/register.server";
import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  venueCapacityReachedMessage,
} from "#/features/events/registration";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string): SessionUser => ({
  id,
  role,
  name: id,
  email: `${id}@x.test`,
});

const organiser = actor("registration-organiser", "event_organiser");
const coordinator = actor("registration-coordinator", "event_coordinator");
const attendees = Array.from({ length: 12 }, (_, index) =>
  actor(`registration-attendee-${index}`, "attendee")
);
const [attendee, secondAttendee, thirdAttendee] = attendees;
/** The Attendees who take the earlier places, kept apart from the three a test names. */
const placeTakers = attendees.slice(3);

const VENUE_NAME = "Registration Test Hall";
const SMALL_VENUE_NAME = "Registration Test Room";

/** 1 Nov 09:00 to 1 Dec 17:00 Singapore time; `now` sits in the middle unless a test moves it. */
const opensAt = "2026-11-01T09:00";
const closesAt = "2026-12-01T17:00";
const insidePeriod = new Date("2026-11-15T04:00:00Z");

describe("registering for an event (PTR-45)", () => {
  let pool: Pool;
  let database: Database;
  let venueId: number;
  let smallVenueId: number;
  let bookingYear = 2050;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    await database
      .insert(schema.user)
      .values(
        [organiser, coordinator, ...attendees].map(user => ({
          id: user.id,
          name: user.id,
          email: user.email,
          emailVerified: true,
          role: user.role ?? undefined,
        }))
      )
      .onConflictDoNothing();
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.name, [VENUE_NAME, SMALL_VENUE_NAME]));
    const [venue, smallVenue] = await database
      .insert(schema.venues)
      .values([
        {
          name: VENUE_NAME,
          location: "Level 3",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: SMALL_VENUE_NAME,
          location: "Level 4",
          maxCapacity: 2,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
      ])
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    smallVenueId = smallVenue.id;
  });

  afterAll(async () => {
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.name, [VENUE_NAME, SMALL_VENUE_NAME]));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        [organiser, coordinator, ...attendees].map(user => user.id)
      )
    );
    await pool.end();
  });

  afterEach(async () => {
    if (created.length === 0) return;
    // Registrations and notifications cascade with the event; the booking keeps its venue.
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  /** A confirmed event with registration on and an approved booking at `bookedVenue`. */
  async function createEvent(
    options: {
      status?: "approved" | "confirmed" | "cancelled";
      capacity?: number;
      bookedVenue?: number | null;
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
        decidedByCoordinatorName: "Registration Coordinator",
        decidedAt: new Date(),
        ...(status === "approved"
          ? {}
          : {
              confirmedById: coordinator.id,
              confirmedByName: "Registration Coordinator",
              confirmedAt: new Date(),
            }),
        eventName: `Registration test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T16:00" }],
        expectedAttendance: 10,
        eventType: "Open Day",
        registrationEnabled: true,
        registrationCapacity: options.capacity ?? 40,
        registrationOpensAt: opensAt,
        registrationClosesAt: closesAt,
      })
      .returning({ id: schema.eventRequests.id, eventName: schema.eventRequests.eventName });
    created.push(row.id);

    const bookedVenue = options.bookedVenue === undefined ? venueId : options.bookedVenue;
    if (bookedVenue !== null) {
      // A distant year per booking keeps the overlap constraint from tripping.
      bookingYear += 1;
      await database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId: row.id,
        venueId: bookedVenue,
        requestedById: coordinator.id,
        startsAt: `${bookingYear}-12-05 10:00:00`,
        endsAt: `${bookingYear}-12-05 16:00:00`,
        status: "approved",
      });
    }
    return row;
  }

  const register = (eventId: number, as: SessionUser = attendee, now = insidePeriod) =>
    handleRegisterForEvent({ id: eventId }, as, database as never, now);

  async function refusal(eventId: number, as: SessionUser = attendee, now = insidePeriod) {
    const error = await register(eventId, as, now).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    return (error as Error).message;
  }

  const registrationsFor = (eventId: number) =>
    database
      .select()
      .from(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.eventId, eventId));

  const notificationsFor = (
    eventId: number,
    kind: (typeof schema.notificationKind.enumValues)[number]
  ) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.eventRequestId, eventId), eq(schema.notifications.kind, kind))
      );

  async function registerOthers(eventId: number, count: number) {
    for (const other of placeTakers.slice(0, count)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the places fill in a fixed order
      await register(eventId, other);
    }
  }

  // ── AC2, AC7 ───────────────────────────────────────────────────────────────────────────────
  test("records the registration and sends the Attendee the event information", async () => {
    const event = await createEvent();

    const result = await register(event.id);

    expect(result.status).toBe("registered");
    const [row] = await registrationsFor(event.id);
    expect(row).toMatchObject({ attendeeId: attendee.id, status: "registered" });

    const [notice] = await notificationsFor(event.id, "event_registered");
    expect(notice.recipientId).toBe(attendee.id);
    expect(notice.payload).toEqual({
      eventName: event.eventName,
      venueName: VENUE_NAME,
      venueLocation: "Level 3",
      startsAt: `${bookingYear}-12-05 10:00:00`,
      endsAt: `${bookingYear}-12-05 16:00:00`,
    });
    const parsed = parseNotificationPayload(notice.kind, notice.payload);
    if (!parsed) throw new Error("event_registered did not parse");
    expect(notificationSummary(parsed)).toBe(`You are registered for ${event.eventName}`);
    const { subject } = renderNotificationEmail({ ...parsed, eventRequestId: event.id });
    expect(subject).toBe(`You are registered for ${event.eventName}`);
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  test("follows the period on the Singapore clock, and records nothing outside it", async () => {
    const event = await createEvent();

    // 00:59Z is 08:59 in Singapore, a minute before the period opens; 01:00Z is 09:00.
    expect(await refusal(event.id, attendee, new Date("2026-11-01T00:59:00Z"))).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
    expect(await registrationsFor(event.id)).toEqual([]);
    expect(await notificationsFor(event.id, "event_registered")).toEqual([]);

    expect((await register(event.id, attendee, new Date("2026-11-01T01:00:00Z"))).status).toBe(
      "registered"
    );
    // 09:00Z on 1 Dec is 17:00 in Singapore, the minute the period closes.
    expect(await refusal(event.id, secondAttendee, new Date("2026-12-01T09:00:00Z"))).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
  });

  test.each(["approved", "cancelled"] as const)(
    "refuses an event that is %s, not confirmed, as if it did not exist",
    async status => {
      const event = await createEvent({ status });

      await expect(register(event.id)).rejects.toBeInstanceOf(AuthorizationError);
      expect(await registrationsFor(event.id)).toEqual([]);
    }
  );

  test("refuses a cancelled event the Attendee is registered for the same way", async () => {
    const event = await createEvent({ status: "cancelled" });
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId: event.id, attendeeId: attendee.id });

    await expect(register(event.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("refuses an event id that does not exist the same way", async () => {
    await expect(register(2_000_000_000)).rejects.toThrow("Forbidden");
  });

  test("refuses a confirmed event whose approved booking was released", async () => {
    const event = await createEvent({ bookedVenue: null });
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      venueId,
      requestedById: coordinator.id,
      // Released bookings sit outside the overlap constraint, so any window will do.
      startsAt: `${bookingYear}-12-05 10:00:00`,
      endsAt: `${bookingYear}-12-05 16:00:00`,
      status: "released",
      releaseReason: "Maintenance",
    });

    expect(await refusal(event.id)).toBe(REGISTRATION_NOT_OPEN_MESSAGE);
  });

  // ── AC3, AC4 ───────────────────────────────────────────────────────────────────────────────
  test("refuses a registration once the registered places equal the capacity", async () => {
    const event = await createEvent({ capacity: 2 });
    await registerOthers(event.id, 2);

    expect(await refusal(event.id)).toBe(EVENT_FULL_MESSAGE);
    expect(await registrationsFor(event.id)).toHaveLength(2);
  });

  test("does not count a withdrawn registration against capacity", async () => {
    const event = await createEvent({ capacity: 1 });
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId: event.id, attendeeId: secondAttendee.id, status: "withdrawn" });

    expect((await register(event.id)).status).toBe("registered");
  });

  // ── AC5 ────────────────────────────────────────────────────────────────────────────────────
  test("refuses a registration at the venue's capacity and names it", async () => {
    const event = await createEvent({ capacity: 10, bookedVenue: smallVenueId });
    await registerOthers(event.id, 2);

    expect(await refusal(event.id)).toBe(venueCapacityReachedMessage(2));
    // AC8: the venue is the lower limit, so filling it is filling the event.
    const notices = await notificationsFor(event.id, "registration_threshold_reached");
    expect(notices.map(notice => notice.payload)).toEqual(
      expect.arrayContaining([expect.objectContaining({ registered: 2, limit: 2 })])
    );
    expect(notices).toHaveLength(2);
  });

  // ── AC6 ────────────────────────────────────────────────────────────────────────────────────
  test("refuses a second registration by the same Attendee", async () => {
    const event = await createEvent();
    await register(event.id);

    expect(await refusal(event.id)).toBe(ALREADY_REGISTERED_MESSAGE);
    expect(await registrationsFor(event.id)).toHaveLength(1);
    expect(await notificationsFor(event.id, "event_registered")).toHaveLength(1);
  });

  test("returns a withdrawn registration to registered, with no second row", async () => {
    const event = await createEvent();
    await database.insert(schema.eventRegistrations).values({
      eventId: event.id,
      attendeeId: attendee.id,
      status: "withdrawn",
      registeredAt: new Date("2020-01-01T00:00:00Z"),
    });

    await register(event.id);

    const rows = await registrationsFor(event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("registered");
    expect(rows[0].registeredAt.getTime()).toBeGreaterThan(
      new Date("2020-01-01T00:00:00Z").getTime()
    );
  });

  // ── AC8 ────────────────────────────────────────────────────────────────────────────────────
  test("tells the Organiser and the Coordinator once, when a registration fills the place limit", async () => {
    const event = await createEvent({ capacity: 2 });

    await register(event.id, attendee);
    expect(await notificationsFor(event.id, "registration_threshold_reached")).toEqual([]);

    await register(event.id, secondAttendee);
    const notices = await notificationsFor(event.id, "registration_threshold_reached");
    expect(
      notices.map(notice => ({ recipientId: notice.recipientId, payload: notice.payload }))
    ).toEqual(
      expect.arrayContaining([
        {
          recipientId: organiser.id,
          payload: {
            eventName: event.eventName,
            registered: 2,
            limit: 2,
            audience: "organiser",
          },
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

    expect(await refusal(event.id, thirdAttendee)).toBe(EVENT_FULL_MESSAGE);
    expect(await notificationsFor(event.id, "registration_threshold_reached")).toHaveLength(2);
  });

  // ── AC9 ────────────────────────────────────────────────────────────────────────────────────
  test("tells the Organiser and the Coordinator once at 90% of the limit, then once at the limit", async () => {
    const event = await createEvent({ capacity: 10 });
    // Seven earlier places, written directly: only the crossings are under test here.
    await database
      .insert(schema.eventRegistrations)
      .values(placeTakers.slice(0, 7).map(taker => ({ eventId: event.id, attendeeId: taker.id })));
    const thresholds = async () =>
      (await notificationsFor(event.id, "registration_threshold_reached")).map(notice => ({
        recipientId: notice.recipientId,
        registered: (notice.payload as { registered: number }).registered,
      }));

    await register(event.id, attendee);
    expect(await thresholds()).toEqual([]);

    await register(event.id, secondAttendee);
    expect(await thresholds()).toEqual(
      expect.arrayContaining([
        { recipientId: organiser.id, registered: 9 },
        { recipientId: coordinator.id, registered: 9 },
      ])
    );
    expect(await thresholds()).toHaveLength(2);

    await register(event.id, thirdAttendee);
    expect(await thresholds()).toEqual(
      expect.arrayContaining([
        { recipientId: organiser.id, registered: 10 },
        { recipientId: coordinator.id, registered: 10 },
      ])
    );
    expect(await thresholds()).toHaveLength(4);
  });

  // ── AC3: the last place ────────────────────────────────────────────────────────────────────
  test("makes a registration for the last place wait for the one ahead of it, then refuses it", async () => {
    const event = await createEvent({ capacity: 3 });
    await registerOthers(event.id, 2);
    // A second connection plays the registration ahead: it holds the event row lock the handler
    // takes and fills the last place, uncommitted. If the handler drops its lock, it counts two
    // places, registers too, and the event ends over capacity.
    const client = await pool.connect();
    let registering: Promise<unknown> | undefined;
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
        [event.id, secondAttendee.id]
      );

      registering = register(event.id).catch((caught: unknown) => caught);
      // Commit the place only once this connection blocks the handler, so the handler must count it.
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

    const outcome = await registering;
    expect(outcome).toBeInstanceOf(ConflictError);
    expect((outcome as Error).message).toBe(EVENT_FULL_MESSAGE);
    const rows = await registrationsFor(event.id);
    expect(rows.filter(row => row.status === "registered")).toHaveLength(3);
  });

  test("records one registration when the same Attendee registers twice at once", async () => {
    const event = await createEvent();

    const results = await Promise.allSettled([register(event.id), register(event.id)]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(((rejected as PromiseRejectedResult).reason as Error).message).toBe(
      ALREADY_REGISTERED_MESSAGE
    );
    expect(await registrationsFor(event.id)).toHaveLength(1);
  });
});
