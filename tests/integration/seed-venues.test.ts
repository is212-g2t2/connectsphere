// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { lockVenue } from "#/features/venue-requests/venue-lock.server";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { liftBlockRows, recordBlockRows } from "#/features/venues/blocks.server";
import { OperatingHoursSchema } from "#/features/venues/schema";
import { runSeed, seedVenues, seedVenueUnavailability } from "../../scripts/seed";

/** A Venue Staff account that is not the seed's, to record blocks the seed must keep. */
const otherStaff = {
  id: "seed-venues-other-staff",
  name: "Other Venue Staff",
  email: "seed-venues-other-staff@example.invalid",
  emailVerified: true,
  role: "venue_staff",
} satisfies typeof schema.user.$inferInsert;

describe("seeded venues (PTR-59 criteria 3–4, landing with PTR-26)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(otherStaff).onConflictDoNothing();
  });

  afterAll(async () => {
    await database.delete(schema.user).where(eq(schema.user.id, otherStaff.id));
    await pool.end();
  });

  /** Run `work` under the venue lock, as the block handlers do. */
  function withVenueLock<T>(venueId: number, work: (tx: VenueTx) => Promise<T>): Promise<T> {
    return database.transaction(async tx => {
      const venueTx = tx as unknown as VenueTx;
      await lockVenue(venueTx, venueId);
      return work(venueTx);
    });
  }

  /** Record a block with its ledger row, as the block handler does without notices. */
  async function recordBlock(
    venue: { id: number; name: string },
    period: { startsAt: string; endsAt: string | null; reason: string },
    actorId = otherStaff.id
  ) {
    return withVenueLock(
      venue.id,
      async tx => (await recordBlockRows(tx, venue, period, actorId)).block
    );
  }

  /** Lift a block and restore what it suspended, as the lift handler does without notices. */
  async function liftBlock(blockId: number): Promise<void> {
    const [preview] = await database
      .select({ venueId: schema.venueUnavailability.venueId })
      .from(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, blockId));
    await withVenueLock(preview.venueId, async tx => {
      const [block] = await tx
        .select()
        .from(schema.venueUnavailability)
        .where(eq(schema.venueUnavailability.id, blockId))
        .for("update");
      await liftBlockRows(tx, block, otherStaff.id);
    });
  }

  /** The seed venue that a seed period names. */
  async function venueOf(period: { venueName: string }) {
    const [venue] = await database
      .select({ id: schema.venues.id, name: schema.venues.name })
      .from(schema.venues)
      .where(eq(schema.venues.name, period.venueName));
    return venue;
  }

  /**
   * Run the seed, then block the whole day of the seeded attendee booking, as Venue Staff can. The
   * recorder suspends the booking. Return the booking's venue and day, and the block.
   */
  async function blockSeedBookingDay(reason: string) {
    await runSeed(database);
    const [booking] = await database
      .select({ venueId: schema.venueOccupancy.venueId, startsAt: schema.venueOccupancy.startsAt })
      .from(schema.venueOccupancy)
      .where(
        and(
          eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"),
          eq(schema.venueOccupancy.active, true)
        )
      )
      .orderBy(asc(schema.venueOccupancy.id))
      .limit(1);
    expect(booking).toBeDefined();
    const day = booking.startsAt.slice(0, 10);
    const [venue] = await database
      .select({ id: schema.venues.id, name: schema.venues.name })
      .from(schema.venues)
      .where(eq(schema.venues.id, booking.venueId));
    const planted = await recordBlock(venue, {
      startsAt: `${day} 00:00:00`,
      endsAt: `${day} 23:59:59`,
      reason,
    });
    return { venue, day, planted };
  }

  /** The live block that the seed recorded for a period. */
  async function liveSeedBlock(period: { venueName: string; reason: string }) {
    const venue = await venueOf(period);
    const [block] = await database
      .select()
      .from(schema.venueUnavailability)
      .where(
        and(
          eq(schema.venueUnavailability.venueId, venue.id),
          eq(schema.venueUnavailability.reason, period.reason),
          isNull(schema.venueUnavailability.liftedAt)
        )
      )
      .orderBy(asc(schema.venueUnavailability.id))
      .limit(1);
    return block;
  }

  async function seedVenueIds(): Promise<number[]> {
    return (
      await database
        .select({ id: schema.venues.id })
        .from(schema.venues)
        .where(
          inArray(
            schema.venues.name,
            seedVenues.map(venue => venue.name)
          )
        )
    ).map(row => row.id);
  }

  it("holds at least three venues, each with every catalogue attribute (AC3)", async () => {
    // Check only seed venue names. `venue-records.test.ts` and `venue-availability.test.ts` also
    // use this container and create venues with empty attribute arrays.
    const seedNames = seedVenues.map(venue => venue.name);
    const rows = await database
      .select()
      .from(schema.venues)
      .where(inArray(schema.venues.name, seedNames))
      .orderBy(asc(schema.venues.id));

    expect(rows.length).toBeGreaterThanOrEqual(seedVenues.length);
    for (const venue of rows) {
      expect(venue.location).not.toBe("");
      expect(venue.maxCapacity).toBeGreaterThan(0);
      expect(venue.facilities.length).toBeGreaterThan(0);
      expect(venue.supportedLayouts.length).toBeGreaterThan(0);
      expect(OperatingHoursSchema.safeParse(venue.operatingHours).success).toBe(true);
    }
  });

  it("records at least two future periods of unavailability (AC4)", async () => {
    const seedIds = await seedVenueIds();
    const rows = await database
      .select()
      .from(schema.venueUnavailability)
      .where(
        and(
          inArray(schema.venueUnavailability.venueId, seedIds),
          isNull(schema.venueUnavailability.liftedAt)
        )
      );

    expect(rows.length).toBeGreaterThanOrEqual(seedVenueUnavailability.length);
    const now = new Date().toISOString();
    for (const period of rows) {
      // With `mode: "string"`, timestamps use `YYYY-MM-DD HH:MM:SS` and sort as dates.
      expect(period.startsAt > now).toBe(true);
      expect(period.endsAt === null || period.endsAt > period.startsAt).toBe(true);
    }
  });

  it("lifts history on re-run while the active set stays one per key (AC5)", async () => {
    // Check only seed rows. `venue-records.test.ts` shares this container and creates its own venue.
    const seedIds = await seedVenueIds();
    const countPeriods = async (activeOnly: boolean) =>
      (
        await database
          .select()
          .from(schema.venueUnavailability)
          .where(
            activeOnly
              ? and(
                  inArray(schema.venueUnavailability.venueId, seedIds),
                  isNull(schema.venueUnavailability.liftedAt)
                )
              : inArray(schema.venueUnavailability.venueId, seedIds)
          )
      ).length;

    const before = { venues: seedIds.length, total: await countPeriods(false) };

    await runSeed(database);
    await runSeed(database);

    const afterIds = await seedVenueIds();
    const after = { venues: afterIds.length, total: await countPeriods(false) };

    // Each run lifts each period and inserts its replacement, so history grows by one per key.
    expect(after.total).toBe(before.total + 2 * seedVenueUnavailability.length);
    expect(after.venues).toBe(before.venues);
    expect(before.venues).toBe(seedVenues.length);

    // The active set keeps one row per `(venue, reason)` key.
    for (const period of seedVenueUnavailability) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed key in turn
      const venue = await venueOf(period);
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed key in turn
      const active = await database
        .select()
        .from(schema.venueUnavailability)
        .where(
          and(
            eq(schema.venueUnavailability.venueId, venue.id),
            eq(schema.venueUnavailability.reason, period.reason),
            isNull(schema.venueUnavailability.liftedAt)
          )
        );
      expect(active).toHaveLength(1);
    }
  });

  it("rewrites a seeded period whose stored dates have gone stale (AC4)", async () => {
    const period = seedVenueUnavailability[0];
    const venue = await venueOf(period);
    const activeWhere = and(
      eq(schema.venueUnavailability.venueId, venue.id),
      eq(schema.venueUnavailability.reason, period.reason),
      isNull(schema.venueUnavailability.liftedAt)
    );

    await database
      .update(schema.venueUnavailability)
      .set({ startsAt: "2000-01-01 00:00:00", endsAt: "2000-01-02 00:00:00" })
      .where(activeWhere);

    await runSeed(database);

    // Read the active row only, so the lifted history row cannot win.
    const [stored] = await database
      .select({
        startsAt: schema.venueUnavailability.startsAt,
        endsAt: schema.venueUnavailability.endsAt,
      })
      .from(schema.venueUnavailability)
      .where(activeWhere)
      .orderBy(asc(schema.venueUnavailability.id))
      .limit(1);

    expect(stored).toEqual({ startsAt: period.startsAt, endsAt: period.endsAt });
  });

  it("writes a live ledger row per seed period with no orphans", async () => {
    await runSeed(database);
    const seedIds = await seedVenueIds();

    for (const period of seedVenueUnavailability) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed period in turn
      const venue = await venueOf(period);
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed period in turn
      const block = await liveSeedBlock(period);
      expect(block).toBeDefined();
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed period in turn
      const rows = await database
        .select()
        .from(schema.venueOccupancy)
        .where(
          and(
            eq(schema.venueOccupancy.venueUnavailabilityId, block.id),
            eq(schema.venueOccupancy.active, true)
          )
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        venueId: venue.id,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        eventId: null,
      });
    }

    // Every block ledger row still points at a live block. The left join exposes an
    // orphan as a row with a null block id.
    const blockRows = await database
      .select({
        blockId: schema.venueUnavailability.id,
        liftedAt: schema.venueUnavailability.liftedAt,
      })
      .from(schema.venueOccupancy)
      .leftJoin(
        schema.venueUnavailability,
        eq(schema.venueUnavailability.id, schema.venueOccupancy.venueUnavailabilityId)
      )
      .where(
        and(
          inArray(schema.venueOccupancy.venueId, seedIds),
          isNotNull(schema.venueOccupancy.venueUnavailabilityId)
        )
      );
    expect(blockRows.length).toBeGreaterThan(0);
    for (const row of blockRows) {
      expect(row.blockId).not.toBeNull();
      expect(row.liftedAt).toBeNull();
    }
  });

  it("suspends a seeded booking under a live user block on re-run", async () => {
    const { planted } = await blockSeedBookingDay("Seed suspension probe");

    // The re-run writes the booking row again. It must stay suspended under the live block.
    await runSeed(database);

    const suspended = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    expect(suspended.length).toBeGreaterThan(0);
    for (const row of suspended) {
      expect(row.active).toBe(false);
    }
    const blockRows = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, planted.id));
    expect(blockRows).toEqual([{ active: true }]);

    // Lift the probe, so later suites see the seeded baseline. The lift restores the booking.
    await liftBlock(planted.id);
    const restored = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    expect(restored).toEqual([{ active: true }]);
  });

  it("stops the seed when its booking would overlap another suspended commitment", async () => {
    const { venue, day, planted } = await blockSeedBookingDay("Seed overlap probe");
    // Another event's booking inside the seeded booking's window, which the block suspended.
    // Write its rows out of band, as an approval before the block would leave them.
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: otherStaff.id,
        status: "submitted",
        submittedAt: new Date(),
        eventName: "Seed overlap probe event",
      })
      .returning({ id: schema.eventRequests.id });
    const window = { startsAt: `${day} 11:00:00`, endsAt: `${day} 12:00:00` };
    await database.insert(schema.venueRequests).values({
      id: "seed-overlap-probe-request",
      eventId: event.id,
      venueId: venue.id,
      requestedById: otherStaff.id,
      status: "approved",
      ...window,
    });
    await database.insert(schema.venueOccupancy).values({
      venueId: venue.id,
      eventId: event.id,
      venueRequestId: "seed-overlap-probe-request",
      active: false,
      ...window,
    });

    // Both suspended rows could not come back, so a lift would fail. The seed stops instead.
    await expect(runSeed(database)).rejects.toThrow("a venue block suspends");

    // Remove the probe event (its rows cascade) and lift the block, so later suites see the
    // seeded baseline. The lift restores the seeded booking.
    await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, event.id));
    await liftBlock(planted.id);
    const restored = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    expect(restored).toEqual([{ active: true }]);
  });

  it("replaces a seed block that an older seed wrote without a creator or a ledger row", async () => {
    await runSeed(database);
    const period = seedVenueUnavailability[0];
    const old = await liveSeedBlock(period);
    // An older seed wrote the block row only, and recorded no creator.
    await database
      .delete(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, old.id));
    await database
      .update(schema.venueUnavailability)
      .set({ createdById: null })
      .where(eq(schema.venueUnavailability.id, old.id));

    await runSeed(database);

    const [lifted] = await database
      .select({ liftedAt: schema.venueUnavailability.liftedAt })
      .from(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, old.id));
    expect(lifted.liftedAt).not.toBeNull();
    const replacement = await liveSeedBlock(period);
    expect(replacement.id).not.toBe(old.id);
    expect(replacement.createdById).toBe("seed-venue-staff-1");
    const ledger = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, replacement.id));
    expect(ledger).toEqual([{ active: true }]);
  });

  it.each([
    { nullCreator: false, dayOffset: 200 },
    { nullCreator: true, dayOffset: 210 },
  ])(
    "keeps a Venue Staff block that has a seed reason on re-run (creator gone: $nullCreator)",
    async ({ nullCreator, dayOffset }) => {
      await runSeed(database);
      const period = seedVenueUnavailability[1];
      const venue = await venueOf(period);
      // Use a day far past every seed period and booking, so only the creator or the ledger row
      // tells the blocks apart. Each case uses its own day.
      const day = new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);
      const staffBlock = await recordBlock(venue, {
        startsAt: `${day} 09:00:00`,
        endsAt: `${day} 10:00:00`,
        reason: period.reason,
      });
      if (nullCreator) {
        // A deleted account sets the creator to null (`ON DELETE SET NULL`). The ledger row stays.
        await database
          .update(schema.venueUnavailability)
          .set({ createdById: null })
          .where(eq(schema.venueUnavailability.id, staffBlock.id));
      }

      await runSeed(database);

      const [kept] = await database
        .select({ liftedAt: schema.venueUnavailability.liftedAt })
        .from(schema.venueUnavailability)
        .where(eq(schema.venueUnavailability.id, staffBlock.id));
      expect(kept.liftedAt).toBeNull();
      const ledger = await database
        .select({ active: schema.venueOccupancy.active })
        .from(schema.venueOccupancy)
        .where(eq(schema.venueOccupancy.venueUnavailabilityId, staffBlock.id));
      expect(ledger).toEqual([{ active: true }]);
      // The seed still records its own period for the same venue and reason.
      const seedBlocks = await database
        .select({ startsAt: schema.venueUnavailability.startsAt })
        .from(schema.venueUnavailability)
        .where(
          and(
            eq(schema.venueUnavailability.venueId, venue.id),
            eq(schema.venueUnavailability.reason, period.reason),
            eq(schema.venueUnavailability.createdById, "seed-venue-staff-1"),
            isNull(schema.venueUnavailability.liftedAt)
          )
        );
      expect(seedBlocks).toEqual([{ startsAt: period.startsAt }]);

      await liftBlock(staffBlock.id);
    }
  );

  it("skips a seed period that another live block covers", async () => {
    await runSeed(database);
    const period = seedVenueUnavailability[0];
    const venue = await venueOf(period);
    // Lift the seed's block, then record a wider block over the same window, as Venue Staff can
    // from the calendar. The wider block is the live one now.
    await liftBlock((await liveSeedBlock(period)).id);
    const widerEnds = new Date(Date.parse(`${period.endsAt.replace(" ", "T")}Z`) + 2 * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const planted = await recordBlock(venue, {
      startsAt: period.startsAt,
      endsAt: widerEnds,
      reason: "Seed skip probe",
    });

    // The re-run skips the period instead of failing.
    await expect(runSeed(database)).resolves.toBeUndefined();

    const live = await database
      .select({ reason: schema.venueUnavailability.reason })
      .from(schema.venueUnavailability)
      .where(
        and(
          eq(schema.venueUnavailability.venueId, venue.id),
          isNull(schema.venueUnavailability.liftedAt)
        )
      );
    expect(live.map(row => row.reason)).toContain("Seed skip probe");
    expect(live.map(row => row.reason)).not.toContain(period.reason);

    // Lift the probe and re-seed, so later suites see the baseline.
    await liftBlock(planted.id);
    await runSeed(database);
    const baseline = await database
      .select({ reason: schema.venueUnavailability.reason })
      .from(schema.venueUnavailability)
      .where(
        and(
          eq(schema.venueUnavailability.venueId, venue.id),
          isNull(schema.venueUnavailability.liftedAt)
        )
      );
    expect(baseline.map(row => row.reason)).toContain(period.reason);
    expect(baseline.map(row => row.reason)).not.toContain("Seed skip probe");
  });
});
