// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { render } from "@react-email/render";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { sweepVenueHoldExpiries } from "#/features/venue-requests/hold-expiry.server";
import {
  handleConvertVenueHold,
  handleSetVenueHoldExpiry,
  handleSetVenueHoldWarning,
} from "#/features/venue-requests/holds.server";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { HOLD_REQUEST_EXPIRY, requestAndPlaceHold } from "./hold-request";

/**
 * PTR-143: the hold expiry sweep, tested at the sweep boundary.
 *
 * Acceptance criteria:
 *   AC1: A due hold becomes expired, its occupancy row goes in the same transaction, the venue is
 *        free again, the reader hides the hold, and conversion is refused.
 *   AC2: The warning point reminds the assigned Coordinator, and the expiry notifies again. A hold
 *        with no warning point gets only the expiry notice. The recipient falls back to the
 *        Coordinator who requested the hold, and the notice is skipped when neither exists. Both
 *        kinds render as email.
 *   AC3: A re-run processes nothing again and creates no duplicate notice, and concurrent runs
 *        raise one set of notices.
 *   AC4: An expired hold cannot be converted; a new hold creates a new record.
 */

const users = {
  organiser: {
    id: "ptr143-organiser",
    name: "PTR-143 Organiser",
    email: "ptr143-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr143-coordinator",
    name: "PTR-143 Coordinator",
    email: "ptr143-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "ptr143-other-coordinator",
    name: "PTR-143 Other Coordinator",
    email: "ptr143-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr143-venue-staff",
    name: "PTR-143 Venue Staff",
    email: "ptr143-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAME = "PTR-143 Auditorium";
const ANNEX_NAME = "PTR-143 Annex";
const EVENT_DAY = "2099-06-15";
/** Singapore wall clock reads 2099-06-10 12:00:00. */
const NOON = new Date("2099-06-10T12:00:00+08:00");
const EXPIRY = new Date("2099-06-10T13:00:00+08:00");
const PAST = "2099-06-10T11:00";
const FUTURE = "2099-06-10T13:00";
const userIds = Object.values(users).map(user => user.id);
const session = (user: (typeof users)[keyof typeof users]): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

describe("venue hold expiry sweep (PTR-143)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventId: number;
  let holdId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await clean();
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  async function clean() {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.name, [VENUE_NAME, ANNEX_NAME]));
  }

  beforeEach(async () => {
    await clean();
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "PTR-143 Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
        setupMinutes: 30,
        turnaroundMinutes: 45,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-143 Event",
        proposedDates: [{ start: `${EVENT_DAY}T09:00`, end: `${EVENT_DAY}T12:00` }],
        expectedAttendance: 100,
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
    const hold = await requestAndPlaceHold(
      { venueId, eventId, date: EVENT_DAY, startTime: "09:00", endTime: "12:00" },
      session(users.coordinator),
      database as never,
      HOLD_REQUEST_EXPIRY
    );
    holdId = hold.id;
  });

  const setExpiry = (expiresAt: string, actor = users.venueStaff) =>
    handleSetVenueHoldExpiry({ id: holdId, expiresAt }, session(actor), database as never);
  const setWarning = (warnAt: string | null, actor = users.coordinator) =>
    handleSetVenueHoldWarning({ id: holdId, warnAt }, session(actor), database as never);
  /**
   * Write the expiry without the handler's future check, so the suite can make a hold due or a
   * legacy row with no expiry. Venue Staff place a hold with a future expiry, so only direct input
   * reaches these shapes.
   */
  const setExpiryDirect = (id: string, expiresAt: string | null) =>
    database.update(schema.venueHolds).set({ expiresAt }).where(eq(schema.venueHolds.id, id));
  const holdRow = async () =>
    (await database.select().from(schema.venueHolds).where(eq(schema.venueHolds.id, holdId))).at(0);
  const occupancy = () =>
    database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueHoldId, holdId));
  const notices = (kind?: "venue_hold_expiring" | "venue_hold_expired") =>
    database
      .select()
      .from(schema.notifications)
      .where(
        kind
          ? and(
              eq(schema.notifications.eventRequestId, eventId),
              eq(schema.notifications.kind, kind)
            )
          : and(
              eq(schema.notifications.eventRequestId, eventId),
              // A request and its placement raise notices of their own kinds.
              inArray(schema.notifications.kind, ["venue_hold_expiring", "venue_hold_expired"])
            )
      );

  /**
   * Hold the venue's advisory lock while both runs start, so both wait on the same lock and
   * contend for it. Without this barrier, one run can commit before the other reads.
   */
  async function raceForVenue<A, B>(
    contenderA: () => Promise<A>,
    contenderB: () => Promise<B>
  ): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
    const gate = new Pool({ connectionString: process.env.DATABASE_URL });
    const gateClient = await gate.connect();
    try {
      await gateClient.query("SELECT pg_advisory_lock($1::integer)", [venueId]);
      const pending = Promise.allSettled([contenderA(), contenderB()]);
      try {
        await vi.waitFor(
          async () => {
            // Limit the barrier to this venue. Writers use single-bigint transaction locks
            // (classid 0, objid is the venue id, objsubid 1; verified in `pg_locks`).
            const waiting = await database.execute<{ count: string }>(
              sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = 0 AND objid = ${venueId} AND objsubid = 1`
            );
            // Both runs must wait on the venue lock. A run that does not take it fails here.
            expect(Number(waiting.rows[0].count)).toBeGreaterThanOrEqual(2);
          },
          { timeout: 2500, interval: 25 }
        );
      } finally {
        await gateClient.query("SELECT pg_advisory_unlock($1::integer)", [venueId]);
      }
      return pending;
    } finally {
      gateClient.release();
      await gate.end();
    }
  }

  it("expires a due hold, frees its ledger row and the venue, and hides it (AC1)", async () => {
    await setExpiryDirect(holdId, PAST);
    expect(await holdRow()).toMatchObject({ status: "held" });

    const count = await sweepVenueHoldExpiries(database as never, NOON);

    expect(count).toBe(1);
    expect(await holdRow()).toMatchObject({ status: "expired" });
    expect(await occupancy()).toEqual([]);
    const schedule = await handleGetVenueAvailability(
      { venueId, startDate: EVENT_DAY, endDate: EVENT_DAY },
      users.coordinator.id,
      database as never
    );
    expect(schedule?.occupied.some(period => period.id === holdId)).toBe(false);

    // The freed window accepts a new hold for the same event (AC4).
    const reHeld = await requestAndPlaceHold(
      { venueId, eventId, date: EVENT_DAY, startTime: "09:00", endTime: "12:00" },
      session(users.coordinator),
      database as never,
      HOLD_REQUEST_EXPIRY
    );
    expect(reHeld).toMatchObject({ status: "held", venueId });
    expect(reHeld.id).not.toBe(holdId);
  });

  it("refuses to convert an expired hold (AC1, AC4)", async () => {
    await setExpiryDirect(holdId, PAST);
    await sweepVenueHoldExpiries(database as never, NOON);

    await expect(
      handleConvertVenueHold({ id: holdId }, session(users.coordinator), database as never)
    ).rejects.toThrow("This hold is no longer active or has been converted.");
    expect(await holdRow()).toMatchObject({ status: "expired" });
  });

  it("warns at the warning point and notifies again at expiry (AC2)", async () => {
    await setExpiry(FUTURE);
    await setWarning(PAST);

    const warned = await sweepVenueHoldExpiries(database as never, NOON);

    expect(warned).toBe(0);
    expect(await holdRow()).toMatchObject({ status: "held" });
    expect(await occupancy()).toHaveLength(1);
    expect(await notices("venue_hold_expiring")).toMatchObject([
      {
        recipientId: users.coordinator.id,
        kind: "venue_hold_expiring",
        payload: { venueHoldId: holdId, expiresAt: "2099-06-10 13:00:00" },
      },
    ]);
    expect(await notices("venue_hold_expired")).toEqual([]);

    const expired = await sweepVenueHoldExpiries(database as never, EXPIRY);

    expect(expired).toBe(1);
    expect(await holdRow()).toMatchObject({ status: "expired" });
    expect(await notices("venue_hold_expired")).toMatchObject([
      {
        recipientId: users.coordinator.id,
        kind: "venue_hold_expired",
        payload: { venueHoldId: holdId, expiresAt: "2099-06-10 13:00:00" },
      },
    ]);
    expect(await notices("venue_hold_expiring")).toHaveLength(1);
  });

  it("sends only the expiry notice when the hold has no warning point (AC2)", async () => {
    await setExpiryDirect(holdId, PAST);
    await sweepVenueHoldExpiries(database as never, NOON);

    expect(await notices("venue_hold_expiring")).toEqual([]);
    expect(await notices("venue_hold_expired")).toHaveLength(1);
  });

  it("falls back to the Coordinator who requested the hold (AC2)", async () => {
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: null })
      .where(eq(schema.eventRequests.id, eventId));
    await setExpiryDirect(holdId, PAST);

    await sweepVenueHoldExpiries(database as never, NOON);

    expect(await notices("venue_hold_expired")).toMatchObject([
      { recipientId: users.coordinator.id },
    ]);
  });

  it("notifies the assigned Coordinator before the requester (AC2)", async () => {
    // The hold's requester is another Coordinator. The assigned Coordinator is the recipient.
    await database
      .update(schema.venueHolds)
      .set({ heldById: users.otherCoordinator.id })
      .where(eq(schema.venueHolds.id, holdId));
    await setExpiryDirect(holdId, PAST);

    await sweepVenueHoldExpiries(database as never, NOON);

    expect(await notices("venue_hold_expired")).toMatchObject([
      { recipientId: users.coordinator.id },
    ]);
  });

  it("expires a hold with no possible recipient and raises no notice (AC2)", async () => {
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: null })
      .where(eq(schema.eventRequests.id, eventId));
    await database
      .update(schema.venueHolds)
      .set({ heldById: null })
      .where(eq(schema.venueHolds.id, holdId));
    await setExpiryDirect(holdId, PAST);

    const count = await sweepVenueHoldExpiries(database as never, NOON);

    expect(count).toBe(1);
    expect(await holdRow()).toMatchObject({ status: "expired" });
    expect(await occupancy()).toEqual([]);
    expect(await notices()).toEqual([]);
  });

  it("does not process an expired hold again (AC3)", async () => {
    await setExpiryDirect(holdId, PAST);

    expect(await sweepVenueHoldExpiries(database as never, NOON)).toBe(1);
    expect(await sweepVenueHoldExpiries(database as never, NOON)).toBe(0);
    expect(await notices("venue_hold_expired")).toHaveLength(1);
  });

  it("keeps a hold that was extended before the sweep (AC3)", async () => {
    await setExpiryDirect(holdId, PAST);
    await setExpiry(FUTURE);

    expect(await sweepVenueHoldExpiries(database as never, NOON)).toBe(0);
    expect(await holdRow()).toMatchObject({ status: "held" });
    expect(await occupancy()).toHaveLength(1);
  });

  it("never sweeps a hold with no expiry", async () => {
    // A row placed before this release may have no expiry. Clear the placed one.
    await setExpiryDirect(holdId, null);
    expect(
      await sweepVenueHoldExpiries(database as never, new Date("2100-01-01T00:00:00+08:00"))
    ).toBe(0);
    expect(await holdRow()).toMatchObject({ status: "held", expiresAt: null });
    expect(await notices()).toEqual([]);
  });

  it("raises one notice per hold when two sweeps run at once (AC3)", async () => {
    await setExpiryDirect(holdId, PAST);
    const secondPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const secondDatabase = drizzle(secondPool, { schema });
    try {
      // Both runs pass their unlocked read and wait on the venue lock. The first to get it
      // expires the hold; the second re-reads and finds nothing.
      const [first, second] = await raceForVenue(
        () => sweepVenueHoldExpiries(database as never, NOON),
        () => sweepVenueHoldExpiries(secondDatabase as never, NOON)
      );
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled");
      const counts = [first, second].map(result =>
        result.status === "fulfilled" ? result.value : -1
      );
      expect(counts[0] + counts[1]).toBe(1);
    } finally {
      await secondPool.end();
    }
    expect(await notices("venue_hold_expired")).toHaveLength(1);
    expect(await holdRow()).toMatchObject({ status: "expired" });
  });

  it("raises one warning when two sweeps run at once (AC3)", async () => {
    // The expiry guard alone cannot make a warning exact-once: the notice read has no unique
    // index, so the venue lock is what stops the second run from inserting its own row.
    await setExpiry(FUTURE);
    await setWarning(PAST);
    const secondPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const secondDatabase = drizzle(secondPool, { schema });
    try {
      const [first, second] = await raceForVenue(
        () => sweepVenueHoldExpiries(database as never, NOON),
        () => sweepVenueHoldExpiries(secondDatabase as never, NOON)
      );
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled");
    } finally {
      await secondPool.end();
    }
    expect(await notices("venue_hold_expiring")).toHaveLength(1);
    expect(await holdRow()).toMatchObject({ status: "held" });
  });

  it("raises one notice per venue when one event holds two venues (AC3)", async () => {
    const [annex] = await database
      .insert(schema.venues)
      .values({
        name: ANNEX_NAME,
        location: "PTR-143 Annexe",
        maxCapacity: 80,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    const secondHold = await requestAndPlaceHold(
      { venueId: annex.id, eventId, date: EVENT_DAY, startTime: "09:00", endTime: "12:00" },
      session(users.coordinator),
      database as never,
      HOLD_REQUEST_EXPIRY
    );
    await setExpiryDirect(holdId, PAST);
    await setExpiryDirect(secondHold.id, PAST);

    const count = await sweepVenueHoldExpiries(database as never, NOON);

    expect(count).toBe(2);
    const holdIds = (await notices("venue_hold_expired")).map(
      notice => (notice.payload as { venueHoldId: string }).venueHoldId
    );
    expect(holdIds.toSorted()).toEqual([holdId, secondHold.id].toSorted());
  });

  it("carries both notices on the email channel (AC2)", async () => {
    await setExpiry(FUTURE);
    await setWarning(PAST);
    await sweepVenueHoldExpiries(database as never, NOON);
    await sweepVenueHoldExpiries(database as never, EXPIRY);

    const rows = await notices();
    await Promise.all(
      (["venue_hold_expiring", "venue_hold_expired"] as const).map(async kind => {
        const row = rows.find(notice => notice.kind === kind);
        expect(row).toBeDefined();
        if (!row) return;
        const parsed = parseNotificationPayload(row.kind, row.payload);
        if (!parsed) throw new Error(`unreadable notification kind: ${row.kind}`);
        expect(notificationSummary(parsed)).toBe(
          kind === "venue_hold_expiring"
            ? `Tentative hold expires soon: ${VENUE_NAME}`
            : `Tentative hold expired: ${VENUE_NAME}`
        );
        const { subject, element } = renderNotificationEmail({
          ...parsed,
          eventRequestId: row.eventRequestId,
        });
        expect(subject).toBe(notificationSummary(parsed));
        const html = await render(element);
        expect(html).toContain(VENUE_NAME);
        // The template's own heading and preview text, not only the shared summary.
        expect(html).toContain(
          kind === "venue_hold_expiring" ? "Tentative hold expires soon" : "Tentative hold expired"
        );
      })
    );
  });
});
