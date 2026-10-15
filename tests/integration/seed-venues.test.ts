// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { OperatingHoursSchema } from "#/features/venues/schema";
import { runSeed, seedVenues, seedVenueUnavailability } from "../../scripts/seed";

describe("seeded venues (PTR-59 criteria 3–4, landing with PTR-26)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

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
      const [venue] = await database
        .select({ id: schema.venues.id })
        .from(schema.venues)
        .where(eq(schema.venues.name, period.venueName));
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
    const [venue] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, period.venueName));
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
      const [venue] = await database
        .select({ id: schema.venues.id })
        .from(schema.venues)
        .where(eq(schema.venues.name, period.venueName));
      // oxlint-disable-next-line eslint/no-await-in-loop -- check each seed period in turn
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
    await runSeed(database);
    const [booking] = await database
      .select({
        venueId: schema.venueOccupancy.venueId,
        startsAt: schema.venueOccupancy.startsAt,
      })
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
    // Plant a live user block covering the whole booking day, as the block recorder writes
    // it: the fully covered booking flips inactive first, so the block row lands cleanly.
    const day = booking.startsAt.slice(0, 10);
    await database
      .update(schema.venueOccupancy)
      .set({ active: false })
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    const [planted] = await database
      .insert(schema.venueUnavailability)
      .values({
        venueId: booking.venueId,
        startsAt: `${day} 00:00:00`,
        endsAt: `${day} 23:59:59`,
        reason: "Seed suspension probe",
        createdById: "seed-venue-staff-1",
      })
      .returning({ id: schema.venueUnavailability.id });
    await database.insert(schema.venueOccupancy).values({
      venueId: booking.venueId,
      eventId: null,
      venueUnavailabilityId: planted.id,
      startsAt: `${day} 00:00:00`,
      endsAt: `${day} 23:59:59`,
      setupMinutes: 0,
      turnaroundMinutes: 0,
      active: true,
    });

    await runSeed(database);

    const suspended = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    expect(suspended.length).toBeGreaterThan(0);
    for (const row of suspended) {
      expect(row.active).toBe(false);
    }

    // Take the probe back out so later suites see the seeded baseline.
    await database
      .delete(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, planted.id));
    await database
      .delete(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, planted.id));
    await runSeed(database);
    const restored = await database
      .select({ active: schema.venueOccupancy.active })
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, "demo-attendee-venue-request-1"));
    expect(restored).toEqual([{ active: true }]);
  });

  it("skips a seed period that another live block covers", async () => {
    await runSeed(database);
    const period = seedVenueUnavailability[0];
    const [venue] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, period.venueName));
    // Lift the seed's block, then record a wider user block over the same window, as Venue
    // Staff can from the calendar: the user block is the live one now.
    const [seedBlock] = await database
      .select({ id: schema.venueUnavailability.id })
      .from(schema.venueUnavailability)
      .where(
        and(
          eq(schema.venueUnavailability.venueId, venue.id),
          eq(schema.venueUnavailability.reason, period.reason),
          isNull(schema.venueUnavailability.liftedAt)
        )
      );
    await database
      .delete(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, seedBlock.id));
    await database
      .update(schema.venueUnavailability)
      .set({ liftedAt: new Date(), liftedById: "seed-venue-staff-1" })
      .where(eq(schema.venueUnavailability.id, seedBlock.id));
    const widerEnds = new Date(Date.parse(`${period.endsAt.replace(" ", "T")}Z`) + 2 * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const [planted] = await database
      .insert(schema.venueUnavailability)
      .values({
        venueId: venue.id,
        startsAt: period.startsAt,
        endsAt: widerEnds,
        reason: "Seed skip probe",
        createdById: "seed-venue-staff-1",
      })
      .returning({ id: schema.venueUnavailability.id });
    await database.insert(schema.venueOccupancy).values({
      venueId: venue.id,
      eventId: null,
      venueUnavailabilityId: planted.id,
      startsAt: period.startsAt,
      endsAt: widerEnds,
      setupMinutes: 0,
      turnaroundMinutes: 0,
      active: true,
    });

    // The re-run lifts the seed's own row, then skips the period instead of failing.
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

    // Take the probe back out and re-seed so later suites see the baseline.
    await database
      .delete(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueUnavailabilityId, planted.id));
    await database
      .delete(schema.venueUnavailability)
      .where(eq(schema.venueUnavailability.id, planted.id));
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
