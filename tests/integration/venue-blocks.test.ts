// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleAmendVenueBooking,
  handleReleaseVenueBooking,
} from "#/features/venue-requests/bookings.server";
import {
  handleCreateVenueHold,
  handleReleaseVenueHold,
} from "#/features/venue-requests/holds.server";
import { loadPendingConflictKinds } from "#/features/venue-requests/records.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
} from "#/features/venue-requests/requests.server";
import { venueBlockConflictMessage } from "#/features/venue-requests/schema";
import { handleLiftVenueBlock, handleRecordVenueBlock } from "#/features/venues/blocks.server";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-136: venue blocks suspend the covered commitments and restore them on lift.
 * Each test runs against the real database with its own venues and events.
 */

const users = {
  organiser: {
    id: "ptr-136-organiser",
    name: "PTR-136 Organiser",
    email: "ptr-136-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr-136-coordinator",
    name: "PTR-136 Coordinator",
    email: "ptr-136-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  coordinatorB: {
    id: "ptr-136-coordinator-b",
    name: "PTR-136 Coordinator B",
    email: "ptr-136-coordinator-b@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr-136-staff",
    name: "PTR-136 Staff",
    email: "ptr-136-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const HALL = "PTR-136 Block Hall";
const ANNEX = "PTR-136 Block Annex";
const DATE = "2027-09-15";

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const coordinator = session(users.coordinator);
const staff = session(users.venueStaff);

describe("venue blocks (PTR-136)", () => {
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
    // Events cascade to their requests, holds, ledger rows and notifications; venues cascade to blocks.
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
          location: "PTR-136 Wing",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    [hallId, annexId] = venues.map(venue => venue.id);
  });

  async function createEvent(name: string, assignee = users.coordinator.id) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: assignee,
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

  /** Raise a request for a new event and return its id. Pass an event id to reuse that event. */
  async function raise(startTime: string, endTime: string, venueId = hallId, eventId?: number) {
    const id = eventId ?? (await createEvent(`PTR-136 ${startTime}-${endTime}`));
    const request = await handleCreateVenueRequest(
      { eventId: id, venueId, date: DATE, startTime, endTime },
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
        eventId: eventId ?? (await createEvent(`PTR-136 hold ${startTime}`)),
        venueId: hallId,
        date: DATE,
        startTime,
        endTime,
      },
      coordinator,
      database as never
    );
  }

  /** Record a block; omit the end time for an open-ended block. */
  async function recordBlock(startTime: string, endTime?: string, venueId = hallId) {
    return handleRecordVenueBlock(
      endTime === undefined
        ? { venueId, date: DATE, startTime, reason: "PTR-136 maintenance" }
        : { venueId, date: DATE, startTime, endDate: DATE, endTime, reason: "PTR-136 maintenance" },
      staff,
      database as never
    );
  }

  function liftBlock(id: number, actor: SessionUser = staff) {
    return handleLiftVenueBlock({ id }, actor, database as never);
  }

  function ledgerRows() {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(inArray(schema.venueOccupancy.venueId, [hallId, annexId]))
      .orderBy(schema.venueOccupancy.id);
  }

  function ledgerForRequest(id: string) {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, id))
      .orderBy(schema.venueOccupancy.startsAt);
  }

  function ledgerForHold(id: string) {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueHoldId, id))
      .orderBy(schema.venueOccupancy.startsAt);
  }

  function ledgerForBlock(id: number) {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, id));
  }

  /** The block notifications for this suite's events. Other handlers raise other kinds. */
  async function blockNotices() {
    const events = await database
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    const ids = events.map(event => event.id);
    if (ids.length === 0) return [];
    return database
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.kind, "venue_block_changed"),
          inArray(schema.notifications.eventRequestId, ids)
        )
      );
  }

  it("suspends a fully covered booking and refuses new requests and holds inside the block", async () => {
    await setBuffers(hallId, 30, 45);
    const id = await raise("10:00", "12:00");
    await approve(id);
    const block = await recordBlock("09:00", "13:00");

    // The row flips inactive and keeps its stored buffers; the booking stays approved.
    expect(await ledgerForRequest(id)).toEqual([
      expect.objectContaining({
        venueRequestId: id,
        startsAt: `${DATE} 10:00:00`,
        endsAt: `${DATE} 12:00:00`,
        setupMinutes: 30,
        turnaroundMinutes: 45,
        active: false,
      }),
    ]);
    const [booking] = await database
      .select({ status: schema.venueRequests.status })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, id));
    expect(booking.status).toBe("approved");

    // The block row and its ledger row exist (buffers 0, no event).
    const [stored] = await database
      .select()
      .from(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, block.id));
    expect(stored).toMatchObject({
      venueId: hallId,
      startsAt: `${DATE} 09:00:00`,
      endsAt: `${DATE} 13:00:00`,
    });
    expect(await ledgerForBlock(block.id)).toEqual([
      expect.objectContaining({
        eventId: null,
        venueUnavailabilityId: block.id,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        active: true,
      }),
    ]);

    // A new request inside the block is refused at approval with the availability reason; a new
    // hold at creation with the block's period.
    const refused = await raise("10:30", "11:00");
    await expect(approve(refused)).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expect.stringContaining("cannot host this window"),
    });
    await expect(hold("10:30", "11:00")).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("is unavailable"),
    });

    const availability = await handleGetVenueAvailability(
      { venueId: hallId, startDate: DATE, endDate: DATE },
      users.coordinator.id,
      database as never
    );
    expect(availability?.occupied).toContainEqual(expect.objectContaining({ state: "blocked" }));
  });

  it("splits a partly covered booking into an inactive intersection and active remainders", async () => {
    await setBuffers(hallId, 30, 45);
    const id = await raise("10:00", "12:00");
    await approve(id);
    // Occupied 09:30 to 12:45; the block takes the middle hour.
    await recordBlock("11:00", "12:00");

    expect(
      (await ledgerForRequest(id)).map(row => ({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        active: row.active,
        setupMinutes: row.setupMinutes,
        turnaroundMinutes: row.turnaroundMinutes,
        venueRequestId: row.venueRequestId,
      }))
    ).toEqual([
      {
        startsAt: `${DATE} 09:30:00`,
        endsAt: `${DATE} 11:00:00`,
        active: true,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        venueRequestId: id,
      },
      {
        startsAt: `${DATE} 11:00:00`,
        endsAt: `${DATE} 12:00:00`,
        active: false,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        venueRequestId: id,
      },
      {
        startsAt: `${DATE} 12:00:00`,
        endsAt: `${DATE} 12:45:00`,
        active: true,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        venueRequestId: id,
      },
    ]);
  });

  it("splits a turnaround-only cover into an active remainder and an inactive tail", async () => {
    await setBuffers(hallId, 30, 45);
    const id = await raise("10:00", "12:00");
    await approve(id);
    await recordBlock("12:30", "13:00");

    expect(
      (await ledgerForRequest(id)).map(row => ({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        active: row.active,
      }))
    ).toEqual([
      { startsAt: `${DATE} 09:30:00`, endsAt: `${DATE} 12:30:00`, active: true },
      { startsAt: `${DATE} 12:30:00`, endsAt: `${DATE} 12:45:00`, active: false },
    ]);
  });

  it("records an open-ended block, refuses later bookings, and clears it on lift", async () => {
    const block = await recordBlock("10:00");
    expect(block.endsAt).toBeNull();

    const blockRows = await ledgerForBlock(block.id);
    expect(blockRows).toHaveLength(1);
    expect(blockRows[0].endsAt).toBeNull();

    const refused = await raise("11:00", "12:00");
    await expect(approve(refused)).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("cannot host this window"),
    });
    // The hold still names the open block as until lifted.
    await expect(hold("11:00", "12:00")).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("until lifted"),
    });

    await liftBlock(block.id);
    expect(await ledgerForBlock(block.id)).toEqual([]);
    const [stored] = await database
      .select()
      .from(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, block.id));
    expect(stored.liftedAt).not.toBeNull();
  });

  it("suspends a held hold and restores it on lift", async () => {
    const held = await hold("10:00", "11:00");
    const block = await recordBlock("09:00", "13:00");

    expect(await ledgerForHold(held.id)).toEqual([expect.objectContaining({ active: false })]);
    const [kept] = await database
      .select({ status: schema.venueHolds.status })
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, held.id));
    expect(kept.status).toBe("held");

    await expect(hold("10:30", "11:00")).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("is unavailable"),
    });

    await liftBlock(block.id);
    expect(await ledgerForHold(held.id)).toEqual([expect.objectContaining({ active: true })]);

    const released = await handleReleaseVenueHold({ id: held.id }, coordinator, database as never);
    expect(released.status).toBe("released");
    expect(await ledgerForHold(held.id)).toEqual([]);
  });

  it("refuses an overlapping or identical finite block and suspends nothing new", async () => {
    const id = await raise("10:30", "11:30");
    await approve(id);
    await recordBlock("10:00", "12:00");
    const before = await ledgerRows();

    const expected = venueBlockConflictMessage({
      venueName: HALL,
      startsAt: `${DATE} 10:00:00`,
      endsAt: `${DATE} 12:00:00`,
    });
    await expect(recordBlock("11:00", "13:00")).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expected,
    });
    await expect(recordBlock("10:00", "12:00")).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expected,
    });
    expect(await ledgerRows()).toEqual(before);
    expect((await ledgerForRequest(id))[0].active).toBe(false);
  });

  it("refuses an open-ended block that overlaps a finite block, naming the finite period", async () => {
    await recordBlock("10:00", "12:00");
    const expected = venueBlockConflictMessage({
      venueName: HALL,
      startsAt: `${DATE} 10:00:00`,
      endsAt: `${DATE} 12:00:00`,
    });
    await expect(recordBlock("11:00")).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expected,
    });
  });

  it("refuses a second open-ended block, naming the first as until lifted", async () => {
    await recordBlock("10:00");
    const expected = venueBlockConflictMessage({
      venueName: HALL,
      startsAt: `${DATE} 10:00:00`,
      endsAt: null,
    });
    expect(expected).toContain("until lifted");
    await expect(recordBlock("11:00")).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expected,
    });
  });

  it("refuses an approval under a block that reaches only into the buffers", async () => {
    // The request window 12:00-13:00 is open and block-free; its setup buffer starts at 11:30,
    // which the block covers. Availability passes, so the ledger names the block's period.
    await setBuffers(hallId, 30, 45);
    const block = await recordBlock("11:45", "11:55");
    const refused = await raise("12:00", "13:00");

    await expect(approve(refused)).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: venueBlockConflictMessage({
        venueName: HALL,
        startsAt: `${DATE} 11:45:00`,
        endsAt: `${DATE} 11:55:00`,
      }),
    });
    const [request] = await database
      .select({ status: schema.venueRequests.status })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, refused));
    expect(request.status).toBe("pending");
    expect(await ledgerForBlock(block.id)).toHaveLength(1);
  });

  // ADR-8: the flag and approval name an unavailable venue before a booking before a hold.
  it.each(["booking", "hold"] as const)(
    "flags and refuses a window that meets a block and a %s as unavailable",
    async other => {
      // The other commitment takes 09:00-10:00 and the block takes 10:00-11:00. They do not
      // overlap, so both ledger rows stay active. The pending window 09:30-10:30 meets both.
      if (other === "booking") await approve(await raise("09:00", "10:00"));
      else await hold("09:00", "10:00");
      await recordBlock("10:00", "11:00");
      const pending = await raise("09:30", "10:30");

      const kinds = await loadPendingConflictKinds(database, [pending]);
      expect(kinds.get(pending)).toBe("unavailable");
      await expect(approve(pending)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `${HALL} cannot host this window: Unavailable on ${DATE}: PTR-136 maintenance.`,
      });
    }
  );

  it("flags and refuses a window whose buffers meet a block and whose window meets a booking as unavailable", async () => {
    // The booking 10:00-11:00 occupies 09:30-11:00. The block 09:00-09:20 does not touch it.
    // The pending window 09:45-10:30 is free of the block, but its setup buffer starts at 09:15.
    await setBuffers(hallId, 30, 0);
    await approve(await raise("10:00", "11:00"));
    await recordBlock("09:00", "09:20");
    const pending = await raise("09:45", "10:30");

    const kinds = await loadPendingConflictKinds(database, [pending]);
    expect(kinds.get(pending)).toBe("unavailable");
    await expect(approve(pending)).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: venueBlockConflictMessage({
        venueName: HALL,
        startsAt: `${DATE} 09:00:00`,
        endsAt: `${DATE} 09:20:00`,
      }),
    });
  });

  it("restores suspended rows on lift, frees the period, and refuses a second lift", async () => {
    const id = await raise("10:00", "12:00");
    await approve(id);
    const block = await recordBlock("09:00", "13:00");
    expect(await ledgerForRequest(id)).toEqual([expect.objectContaining({ active: false })]);

    const lifted = await liftBlock(block.id);
    expect(lifted.liftedAt).not.toBeNull();
    expect(lifted.liftedById).toBe(users.venueStaff.id);
    expect(await ledgerForRequest(id)).toEqual([expect.objectContaining({ active: true })]);
    expect(await ledgerForBlock(block.id)).toEqual([]);

    await expect(liftBlock(block.id)).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expect.stringContaining("already been lifted"),
    });

    // The period can be approved again once the restored booking is released.
    await handleReleaseVenueBooking({ id, reason: "Moved online" }, staff, database as never);
    const next = await raise("10:00", "12:00");
    expect((await approve(next)).status).toBe("approved");
  });

  it("leaves a booking released during the block released after the lift", async () => {
    const id = await raise("10:00", "12:00");
    await approve(id);
    const block = await recordBlock("09:00", "13:00");

    await handleReleaseVenueBooking({ id, reason: "Moved online" }, staff, database as never);
    const lifted = await liftBlock(block.id);
    expect(lifted.liftedAt).not.toBeNull();

    const [booking] = await database
      .select({ status: schema.venueRequests.status })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, id));
    expect(booking.status).toBe("released");
    expect(await ledgerForRequest(id)).toEqual([]);
  });

  it("leaves an amendment made during the block standing after the lift", async () => {
    const id = await raise("10:00", "12:00");
    await approve(id);
    const block = await recordBlock("09:00", "13:00");

    await handleAmendVenueBooking(
      { id, venueId: hallId, date: DATE, startTime: "14:00", endTime: "15:00" },
      staff,
      database as never
    );
    await liftBlock(block.id);

    expect(await ledgerForRequest(id)).toEqual([
      expect.objectContaining({
        startsAt: `${DATE} 14:00:00`,
        endsAt: `${DATE} 15:00:00`,
        active: true,
      }),
    ]);
    expect(await ledgerForBlock(block.id)).toEqual([]);
  });

  it("refuses the lift when a new arrangement overlaps the block, and rolls back", async () => {
    const id = await raise("10:00", "12:00");
    await approve(id);
    const block = await recordBlock("09:00", "13:00");

    // Out-of-band writes: quiet the block row, then plant an active booking row inside it.
    await database
      .update(schema.venueOccupancy)
      .set({ active: false })
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, block.id));
    const intruderEvent = await createEvent("PTR-136 intruder");
    const intruder = await raise("10:30", "11:00", hallId, intruderEvent);
    await database.insert(schema.venueOccupancy).values({
      venueId: hallId,
      eventId: intruderEvent,
      venueRequestId: intruder,
      startsAt: `${DATE} 10:30:00`,
      endsAt: `${DATE} 11:00:00`,
    });

    await expect(liftBlock(block.id)).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: expect.stringContaining("cannot be lifted"),
    });

    const [stored] = await database
      .select()
      .from(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, block.id));
    expect(stored.liftedAt).toBeNull();
    expect(await ledgerForBlock(block.id)).toEqual([expect.objectContaining({ active: false })]);
    expect(await ledgerForRequest(id)).toEqual([expect.objectContaining({ active: false })]);
  });

  it("notifies each affected event's assigned coordinator once on record", async () => {
    const eventA = await createEvent("PTR-136 notify A");
    const eventB = await createEvent("PTR-136 notify B");
    const first = await raise("10:00", "11:00", hallId, eventA);
    await approve(first);
    const second = await raise("14:00", "15:00", hallId, eventB);
    await approve(second);
    // Move event A to the second coordinator; the notice follows the assignment, not the raiser.
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: users.coordinatorB.id })
      .where(eq(schema.eventRequests.id, eventA));

    await recordBlock("09:00", "16:00");

    const notices = await blockNotices();
    expect(notices).toHaveLength(2);
    expect(notices).toContainEqual(
      expect.objectContaining({
        recipientId: users.coordinatorB.id,
        eventRequestId: eventA,
        payload: expect.objectContaining({ action: "blocked" }),
      })
    );
    expect(notices).toContainEqual(
      expect.objectContaining({
        recipientId: users.coordinator.id,
        eventRequestId: eventB,
        payload: expect.objectContaining({ action: "blocked" }),
      })
    );
  });

  it("sends one record notification when one event has two suspended commitments", async () => {
    const eventId = await createEvent("PTR-136 notify twice");
    const first = await raise("10:00", "11:00", hallId, eventId);
    await approve(first);
    const second = await raise("14:00", "15:00", hallId, eventId);
    await approve(second);

    await recordBlock("09:00", "16:00");

    const notices = await blockNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      recipientId: users.coordinator.id,
      eventRequestId: eventId,
    });
    expect(notices[0].payload).toMatchObject({ action: "blocked" });
  });

  it("notifies the restored event on lift", async () => {
    const id = await raise("10:00", "11:00");
    await approve(id);
    const block = await recordBlock("09:00", "12:00");
    await liftBlock(block.id);

    const notices = await blockNotices();
    expect(
      notices.filter(notice => (notice.payload as { action: string }).action === "blocked")
    ).toHaveLength(1);
    const lifted = notices.filter(
      notice => (notice.payload as { action: string }).action === "lifted"
    );
    expect(lifted).toHaveLength(1);
    expect(lifted[0]).toMatchObject({ recipientId: users.coordinator.id });
  });

  it("raises no notification when the block covers nothing", async () => {
    const id = await raise("10:00", "11:00");
    await approve(id);
    await recordBlock("14:00", "15:00");

    expect(await blockNotices()).toEqual([]);
  });

  it("stores the actor and time with the block's ledger writes", async () => {
    const beforeRecord = new Date();
    const block = await recordBlock("10:00", "12:00");
    expect(block.createdById).toBe(users.venueStaff.id);
    expect(block.createdAt.getTime()).toBeGreaterThanOrEqual(beforeRecord.getTime() - 30_000);
    expect(await ledgerForBlock(block.id)).toHaveLength(1);

    const beforeLift = new Date();
    const lifted = await liftBlock(block.id, session(users.coordinator));
    expect(lifted.liftedById).toBe(users.coordinator.id);
    expect(lifted.liftedAt?.getTime()).toBeGreaterThanOrEqual(beforeLift.getTime() - 30_000);
  });
});
