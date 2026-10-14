// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like, notExists, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleAmendVenueBooking,
  handleReleaseVenueBooking,
} from "#/features/venue-requests/bookings.server";
import {
  handleConvertVenueHold,
  handleCreateVenueHold,
  handleReleaseVenueHold,
} from "#/features/venue-requests/holds.server";
import { occupyVenue } from "#/features/venue-requests/occupancy.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
} from "#/features/venue-requests/requests.server";
import {
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
} from "#/features/venue-requests/schema";
import { handleSaveVenue } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { runSeed } from "../../scripts/seed";

/**
 * PTR-133 and PTR-134: the venue occupancy ledger. The database refuses overlapping active rows
 * (`venue_occupancy_no_overlap`), and every write path keeps the ledger in step with its source
 * in one transaction.
 */

const users = {
  organiser: {
    id: "ptr-133-organiser",
    name: "PTR-133 Organiser",
    email: "ptr-133-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr-133-coordinator",
    name: "PTR-133 Coordinator",
    email: "ptr-133-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr-133-staff",
    name: "PTR-133 Staff",
    email: "ptr-133-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const HALL = "PTR-133 Ledger Hall";
const ANNEX = "PTR-133 Ledger Annex";
const DATE = "2027-08-10";

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const coordinator = session(users.coordinator);
const staff = session(users.venueStaff);

describe("venue occupancy ledger (PTR-133, PTR-134)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let hallId: number;
  let annexId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  async function cleanUp() {
    // Events cascade to their requests, holds and ledger rows; venues cascade to blocks.
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, [HALL, ANNEX]));
  }

  afterAll(async () => {
    await cleanUp();
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(user => user.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await cleanUp();
    const venues = await database
      .insert(schema.venues)
      .values(
        [HALL, ANNEX].map(name => ({
          name,
          location: "PTR-133 Wing",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    [hallId, annexId] = venues.map(venue => venue.id);
  });

  async function createEvent(name: string) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: name,
      })
      .returning({ id: schema.eventRequests.id });
    return event.id;
  }

  async function setBuffers(venueId: number, setupMinutes: number, turnaroundMinutes: number) {
    await database
      .update(schema.venues)
      .set({ setupMinutes, turnaroundMinutes })
      .where(eq(schema.venues.id, venueId));
  }

  /** Raise a request for a new event and return its id. */
  async function raise(startTime: string, endTime: string, venueId = hallId) {
    const eventId = await createEvent(`PTR-133 ${startTime}-${endTime} at ${venueId}`);
    const request = await handleCreateVenueRequest(
      { eventId, venueId, date: DATE, startTime, endTime },
      coordinator,
      database as never
    );
    return request.id;
  }

  function approve(id: string) {
    return handleApproveVenueRequest({ id }, staff, database as never);
  }

  async function hold(startTime: string, endTime: string, eventId?: number) {
    return handleCreateVenueHold(
      {
        eventId: eventId ?? (await createEvent(`PTR-133 hold ${startTime}`)),
        venueId: hallId,
        date: DATE,
        startTime,
        endTime,
      },
      coordinator,
      database as never
    );
  }

  function ledgerRows() {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(inArray(schema.venueOccupancy.venueId, [hallId, annexId]))
      .orderBy(schema.venueOccupancy.id);
  }

  /** A pending request row to stand as a ledger source in the raw-write tests. */
  async function insertSource(id: string, venueId = hallId) {
    const eventId = await createEvent(`PTR-133 source ${id}`);
    await database.insert(schema.venueRequests).values({
      id,
      eventId,
      venueId,
      startsAt: `${DATE} 00:00:00`,
      endsAt: `${DATE} 01:00:00`,
    });
    return eventId;
  }

  async function insertBlock(startTime: string, endTime: string) {
    const [block] = await database
      .insert(schema.venueUnavailability)
      .values({
        venueId: hallId,
        startsAt: `${DATE} ${startTime}:00`,
        endsAt: `${DATE} ${endTime}:00`,
        reason: "PTR-133 block",
      })
      .returning({ id: schema.venueUnavailability.id });
    return block.id;
  }

  /** PTR-134 AC5: the repair query. List approved bookings and held holds without a ledger row. */
  async function commitmentsWithoutRow() {
    const venueIds = [hallId, annexId];
    const [bookings, holds] = await Promise.all([
      database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(
          and(
            inArray(schema.venueRequests.venueId, venueIds),
            eq(schema.venueRequests.status, "approved"),
            notExists(
              database
                .select({ id: schema.venueOccupancy.id })
                .from(schema.venueOccupancy)
                .where(eq(schema.venueOccupancy.venueRequestId, schema.venueRequests.id))
            )
          )
        ),
      database
        .select({ id: schema.venueHolds.id })
        .from(schema.venueHolds)
        .where(
          and(
            inArray(schema.venueHolds.venueId, venueIds),
            eq(schema.venueHolds.status, "held"),
            notExists(
              database
                .select({ id: schema.venueOccupancy.id })
                .from(schema.venueOccupancy)
                .where(eq(schema.venueOccupancy.venueHoldId, schema.venueHolds.id))
            )
          )
        ),
    ]);
    return [...bookings, ...holds].map(row => row.id).toSorted();
  }

  /**
   * Commit a block row from a writer that takes no venue lock, while a handler waits on it in
   * the exclusion check. The handler's pre-check cannot see the uncommitted row, so only the
   * constraint can refuse the handler.
   */
  async function raceUnlockedBlock(handler: () => Promise<unknown>) {
    const blockId = await insertBlock("10:00", "11:00");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into venue_occupancy (venue_id, venue_unavailability_id, starts_at, ends_at) values ($1, $2, $3, $4)",
        [hallId, blockId, `${DATE} 10:00:00`, `${DATE} 11:00:00`]
      );
      const outcome = handler().then(
        () => null,
        (error: unknown) => error
      );
      await vi.waitFor(
        async () => {
          const waiting = await database.execute<{ count: string }>(
            sql`select count(*)::text as count from pg_stat_activity where wait_event_type = 'Lock' and query like 'insert into "venue_occupancy"%'`
          );
          expect(Number(waiting.rows[0].count)).toBe(1);
        },
        { timeout: 10_000, interval: 25 }
      );
      await client.query("commit");
      return await outcome;
    } finally {
      client.release();
    }
  }

  describe("the venue_occupancy_no_overlap constraint (PTR-133 AC1, AC2)", () => {
    it("replaces the per-table constraints and their status wrappers (PTR-133 AC5)", async () => {
      const constraints = await database.execute<{ conname: string }>(
        sql`select conname from pg_constraint where conname like '%no_overlap' order by conname`
      );
      expect(constraints.rows.map(row => row.conname)).toEqual(["venue_occupancy_no_overlap"]);
      const wrappers = await database.execute<{ count: string }>(
        sql`select count(*)::text as count from pg_proc where proname like 'venue_%_occupies_venue'`
      );
      expect(wrappers.rows[0].count).toBe("0");
    });

    it("refuses a booking or a hold row that overlaps a block row once buffers count", async () => {
      const blockId = await insertBlock("10:00", "11:00");
      await database.insert(schema.venueOccupancy).values({
        venueId: hallId,
        venueUnavailabilityId: blockId,
        startsAt: `${DATE} 10:00:00`,
        endsAt: `${DATE} 11:00:00`,
      });
      const bookingEventId = await insertSource("ptr-133-booking");
      const [heldHold] = await database
        .insert(schema.venueHolds)
        .values({
          id: "ptr-133-hold",
          eventId: bookingEventId,
          venueId: hallId,
          startsAt: `${DATE} 08:00:00`,
          endsAt: `${DATE} 09:45:00`,
        })
        .returning({ id: schema.venueHolds.id });

      // Only the setup buffer reaches the block.
      await expect(
        database.insert(schema.venueOccupancy).values({
          venueId: hallId,
          eventId: bookingEventId,
          venueRequestId: "ptr-133-booking",
          startsAt: `${DATE} 11:15:00`,
          endsAt: `${DATE} 12:00:00`,
          setupMinutes: 30,
        })
      ).rejects.toMatchObject({
        cause: { code: "23P01", constraint: "venue_occupancy_no_overlap" },
      });
      // Only the turnaround buffer reaches the block.
      await expect(
        database.insert(schema.venueOccupancy).values({
          venueId: hallId,
          eventId: bookingEventId,
          venueHoldId: heldHold.id,
          startsAt: `${DATE} 08:00:00`,
          endsAt: `${DATE} 09:45:00`,
          turnaroundMinutes: 30,
        })
      ).rejects.toMatchObject({
        cause: { code: "23P01", constraint: "venue_occupancy_no_overlap" },
      });
    });

    it("lets periods touch, and ignores other venues and inactive rows", async () => {
      const eventId = await insertSource("ptr-133-a");
      await insertSource("ptr-133-b");
      const row = (venueRequestId: string, start: string, end: string, extra = {}) => ({
        venueId: hallId,
        eventId,
        venueRequestId,
        startsAt: `${DATE} ${start}:00`,
        endsAt: `${DATE} ${end}:00`,
        ...extra,
      });
      await database
        .insert(schema.venueOccupancy)
        .values(row("ptr-133-a", "10:00", "12:00", { setupMinutes: 30, turnaroundMinutes: 45 }));

      // 10:00 to 12:00 with 30/45 occupies 09:30 to 12:45.
      await expect(
        database.insert(schema.venueOccupancy).values(row("ptr-133-b", "12:30", "13:00"))
      ).rejects.toMatchObject({ cause: { code: "23P01" } });
      await database.insert(schema.venueOccupancy).values(row("ptr-133-b", "12:45", "13:00"));
      await database
        .insert(schema.venueOccupancy)
        .values(row("ptr-133-b", "10:00", "12:00", { venueId: annexId }));
      await database
        .insert(schema.venueOccupancy)
        .values(row("ptr-133-b", "11:00", "11:30", { active: false }));
      expect(await ledgerRows()).toHaveLength(4);
    });
  });

  describe("approval (PTR-133 AC2, PTR-134 AC1)", () => {
    it("refuses 12:30 and 12:45 after a 10:00 to 12:00 booking at a 30/45 venue, and accepts 13:15", async () => {
      await setBuffers(hallId, 30, 45);
      const first = await raise("10:00", "12:00");
      await approve(first);

      // Both buffers count: the later booking's setup must start after 12:45.
      for (const start of ["12:30", "12:45"]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each refusal is checked in turn
        const refused = await raise(start, "14:00");
        // oxlint-disable-next-line eslint/no-await-in-loop -- each refusal is checked in turn
        await expect(approve(refused)).rejects.toMatchObject({
          name: "ConflictError",
          status: 409,
          message: `${HALL} is already booked 10 Aug 2027, 09:30 – 12:45`,
        });
      }
      const accepted = await raise("13:15", "14:00");
      expect((await approve(accepted)).status).toBe("approved");

      expect(
        (await ledgerRows()).map(row => ({ id: row.venueRequestId, startsAt: row.startsAt }))
      ).toEqual([
        { id: first, startsAt: `${DATE} 10:00:00` },
        { id: accepted, startsAt: `${DATE} 13:15:00` },
      ]);
    });

    it("writes exactly one active row with the venue's buffers, and keeps them after a venue edit", async () => {
      await setBuffers(hallId, 30, 45);
      const id = await raise("09:00", "11:00");
      const approved = await approve(id);

      const expected = {
        venueId: hallId,
        eventId: approved.eventId,
        venueRequestId: id,
        venueHoldId: null,
        startsAt: `${DATE} 09:00:00`,
        endsAt: `${DATE} 11:00:00`,
        setupMinutes: 30,
        turnaroundMinutes: 45,
        active: true,
      };
      expect(await ledgerRows()).toEqual([expect.objectContaining(expected)]);

      const [venue] = await database
        .select()
        .from(schema.venues)
        .where(eq(schema.venues.id, hallId));
      await handleSaveVenue(
        { ...venue, setupMinutes: 60, turnaroundMinutes: 60 },
        database as never,
        users.venueStaff.id
      );
      expect(await ledgerRows()).toEqual([expect.objectContaining(expected)]);
    });
  });

  describe("release and amendment (PTR-134 AC3)", () => {
    it("AC3 (PTR-138): two approved bookings on one event write two ledger rows", async () => {
      const eventId = await createEvent("PTR-138 two bookings");
      const first = await handleCreateVenueRequest(
        { eventId, venueId: hallId, date: DATE, startTime: "09:00", endTime: "10:00" },
        coordinator,
        database as never
      );
      const second = await handleCreateVenueRequest(
        { eventId, venueId: annexId, date: DATE, startTime: "11:00", endTime: "12:00" },
        coordinator,
        database as never
      );
      await approve(first.id);
      await approve(second.id);

      expect(
        (await ledgerRows()).map(row => ({
          venueId: row.venueId,
          venueRequestId: row.venueRequestId,
        }))
      ).toEqual([
        { venueId: hallId, venueRequestId: first.id },
        { venueId: annexId, venueRequestId: second.id },
      ]);
    });

    it("AC3 (PTR-138): releasing one booking keeps the sibling approved with its ledger row", async () => {
      const eventId = await createEvent("PTR-138 sibling release");
      const first = await handleCreateVenueRequest(
        { eventId, venueId: hallId, date: DATE, startTime: "09:00", endTime: "10:00" },
        coordinator,
        database as never
      );
      const second = await handleCreateVenueRequest(
        { eventId, venueId: annexId, date: DATE, startTime: "11:00", endTime: "12:00" },
        coordinator,
        database as never
      );
      await approve(first.id);
      await approve(second.id);

      await handleReleaseVenueBooking(
        { id: first.id, reason: "Burst pipe" },
        staff,
        database as never
      );

      const [sibling] = await database
        .select({ status: schema.venueRequests.status })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, second.id));
      expect(sibling.status).toBe("approved");
      expect(await ledgerRows()).toEqual([
        expect.objectContaining({ venueId: annexId, venueRequestId: second.id }),
      ]);
    });

    it("removes the row when the booking is released", async () => {
      const id = await raise("09:00", "11:00");
      await approve(id);
      await handleReleaseVenueBooking({ id, reason: "Burst pipe" }, staff, database as never);
      expect(await ledgerRows()).toEqual([]);
    });

    it("replaces the row with the target venue's buffers, and keeps it when a refusal rolls back", async () => {
      await setBuffers(annexId, 10, 20);
      const id = await raise("09:00", "11:00");
      await approve(id);
      const [original] = await ledgerRows();

      await handleAmendVenueBooking(
        { id, venueId: annexId, date: DATE, startTime: "13:00", endTime: "15:00" },
        staff,
        database as never
      );
      const [replaced] = await ledgerRows();
      expect(replaced.id).not.toBe(original.id);
      expect(replaced).toMatchObject({
        venueId: annexId,
        venueRequestId: id,
        startsAt: `${DATE} 13:00:00`,
        endsAt: `${DATE} 15:00:00`,
        setupMinutes: 10,
        turnaroundMinutes: 20,
      });

      // A refused amendment rolls back its deletion, so the booking keeps its row.
      const other = await raise("16:00", "17:00", annexId);
      await approve(other);
      await expect(
        handleAmendVenueBooking(
          { id, venueId: annexId, date: DATE, startTime: "15:00", endTime: "16:30" },
          staff,
          database as never
        )
      ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
      expect((await ledgerRows()).find(row => row.venueRequestId === id)).toEqual(replaced);
    });
  });

  describe("holds (PTR-134 AC2)", () => {
    it("adds the row with the hold's buffers, and removes it on release and on convert", async () => {
      await setBuffers(hallId, 15, 25);
      const released = await hold("09:00", "10:00");
      expect(await ledgerRows()).toEqual([
        expect.objectContaining({
          venueHoldId: released.id,
          eventId: released.eventId,
          setupMinutes: 15,
          turnaroundMinutes: 25,
        }),
      ]);
      await handleReleaseVenueHold({ id: released.id }, coordinator, database as never);
      expect(await ledgerRows()).toEqual([]);

      const converted = await hold("09:00", "10:00");
      const { request } = await handleConvertVenueHold(
        { id: converted.id },
        coordinator,
        database as never
      );
      // A pending request holds no venue time.
      expect(request.status).toBe("pending");
      expect(await ledgerRows()).toEqual([]);
    });

    it("keeps the row when a refused conversion rolls back the release (PTR-134 AC4)", async () => {
      const eventId = await createEvent("PTR-133 duplicate conversion");
      const held = await hold("09:00", "10:00", eventId);
      // A pending request for the same event and venue makes the conversion's insert fail.
      await handleCreateVenueRequest(
        { eventId, venueId: hallId, date: DATE, startTime: "15:00", endTime: "16:00" },
        coordinator,
        database as never
      );

      await expect(
        handleConvertVenueHold({ id: held.id }, coordinator, database as never)
      ).rejects.toThrow(VENUE_REQUEST_DUPLICATE_MESSAGE);
      expect(await ledgerRows()).toEqual([expect.objectContaining({ venueHoldId: held.id })]);
    });
  });

  describe("a refused ledger write (PTR-133 AC3, PTR-134 AC4)", () => {
    it("rolls back the approval and answers the venue-conflict refusal", async () => {
      const id = await raise("10:00", "11:00");
      expect(await raceUnlockedBlock(() => approve(id))).toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_OCCUPANCY_CONFLICT_MESSAGE,
      });
      const [request] = await database
        .select({ status: schema.venueRequests.status })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, id));
      expect(request.status).toBe("pending");
      // Only the committed block row remains.
      expect(await ledgerRows()).toEqual([expect.objectContaining({ venueRequestId: null })]);
    });

    it("rolls back the hold and answers the venue-conflict refusal", async () => {
      expect(await raceUnlockedBlock(() => hold("10:30", "11:30"))).toMatchObject({
        name: "ConflictError",
        message: VENUE_OCCUPANCY_CONFLICT_MESSAGE,
      });
      expect(
        await database.select().from(schema.venueHolds).where(eq(schema.venueHolds.venueId, hallId))
      ).toEqual([]);
    });

    it("commits one of two unlocked writers that deadlock, and refuses the other", async () => {
      const eventId = await insertSource("ptr-133-d1");
      await Promise.all(["ptr-133-d2", "ptr-133-d3", "ptr-133-d4"].map(id => insertSource(id)));
      const row = (venueRequestId: string, start: string, end: string) => ({
        venueId: hallId,
        eventId,
        venueRequestId,
        startsAt: `${DATE} ${start}:00`,
        endsAt: `${DATE} ${end}:00`,
        setupMinutes: 0,
        turnaroundMinutes: 0,
      });
      const firstWrote = Promise.withResolvers<void>();
      const secondWrote = Promise.withResolvers<void>();

      // Each writer inserts one row, then a row that overlaps the other writer's first row. Each
      // waits for the other, and PostgreSQL aborts one of them with 40P01.
      const outcomes = await Promise.allSettled([
        database.transaction(async tx => {
          await occupyVenue(tx as never, row("ptr-133-d1", "09:00", "10:00"));
          firstWrote.resolve();
          await secondWrote.promise;
          await occupyVenue(tx as never, row("ptr-133-d3", "14:30", "15:30"));
        }),
        firstWrote.promise.then(() =>
          database.transaction(async tx => {
            await occupyVenue(tx as never, row("ptr-133-d2", "14:00", "15:00"));
            secondWrote.resolve();
            await occupyVenue(tx as never, row("ptr-133-d4", "09:30", "10:30"));
          })
        ),
      ]);

      expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({
        reason: { name: "ConflictError", message: VENUE_OCCUPANCY_CONFLICT_MESSAGE },
      });
      expect(await ledgerRows()).toHaveLength(2);
    });
  });

  describe("the repair query (PTR-134 AC5)", () => {
    it("finds no booking or hold without its row after every write path (PTR-134 AC4)", async () => {
      await setBuffers(hallId, 10, 10);
      const booking = await raise("08:00", "09:00");
      await approve(booking);
      await handleAmendVenueBooking(
        { id: booking, venueId: annexId, date: DATE, startTime: "08:00", endTime: "09:30" },
        staff,
        database as never
      );
      const released = await raise("12:00", "13:00");
      await approve(released);
      await handleReleaseVenueBooking(
        { id: released, reason: "Moved online" },
        staff,
        database as never
      );
      await hold("14:00", "15:00");
      const dropped = await hold("16:00", "17:00");
      await handleReleaseVenueHold({ id: dropped.id }, coordinator, database as never);
      const converted = await hold("18:00", "19:00");
      await handleConvertVenueHold({ id: converted.id }, coordinator, database as never);

      expect(await ledgerRows()).toHaveLength(2);
      expect(await commitmentsWithoutRow()).toEqual([]);
    });

    it("finds an approved booking and a held hold that a writer outside the app left without a row", async () => {
      const eventId = await insertSource("ptr-133-missing");
      await database
        .update(schema.venueRequests)
        .set({ status: "approved" })
        .where(eq(schema.venueRequests.id, "ptr-133-missing"));
      await database.insert(schema.venueHolds).values({
        id: "ptr-133-missing-hold",
        eventId,
        venueId: hallId,
        startsAt: `${DATE} 11:00:00`,
        endsAt: `${DATE} 12:00:00`,
      });

      expect(await commitmentsWithoutRow()).toEqual(["ptr-133-missing", "ptr-133-missing-hold"]);
    });
  });

  it("gives each approved seeded booking its row across seed runs, and the pending demo request none", async () => {
    await runSeed(database);
    await runSeed(database);

    const seeded = or(
      like(schema.venueRequests.id, "seed-extra-venue-request-%"),
      like(schema.venueRequests.id, "demo-%venue-request-1")
    );
    const approvedSeeded = await database
      .select({
        id: schema.venueRequests.id,
        venueId: schema.venueRequests.venueId,
        startsAt: schema.venueRequests.startsAt,
        endsAt: schema.venueRequests.endsAt,
      })
      .from(schema.venueRequests)
      .where(and(seeded, eq(schema.venueRequests.status, "approved")));
    const seededRows = await database
      .select({
        id: schema.venueRequests.id,
        venueId: schema.venueOccupancy.venueId,
        startsAt: schema.venueOccupancy.startsAt,
        endsAt: schema.venueOccupancy.endsAt,
      })
      .from(schema.venueOccupancy)
      .innerJoin(
        schema.venueRequests,
        eq(schema.venueRequests.id, schema.venueOccupancy.venueRequestId)
      )
      .where(seeded);
    // One row per approved seeded booking, at its current venue and period.
    expect(seededRows.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      approvedSeeded.toSorted((a, b) => a.id.localeCompare(b.id))
    );
  });
});
