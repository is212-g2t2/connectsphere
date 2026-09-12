// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, inArray } from "drizzle-orm";
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

  it("holds at least three venues, each with every catalogue attribute (AC3)", async () => {
    const rows = await database.select().from(schema.venues).orderBy(asc(schema.venues.id));

    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const venue of rows) {
      expect(venue.location).not.toBe("");
      expect(venue.maxCapacity).toBeGreaterThan(0);
      expect(venue.facilities.length).toBeGreaterThan(0);
      expect(venue.supportedLayouts.length).toBeGreaterThan(0);
      expect(OperatingHoursSchema.safeParse(venue.operatingHours).success).toBe(true);
    }
  });

  it("records at least two future periods of unavailability (AC4)", async () => {
    const rows = await database.select().from(schema.venueUnavailability);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const now = new Date().toISOString();
    for (const period of rows) {
      // `mode: "string"` timestamps come back as `YYYY-MM-DD HH:MM:SS`, which sorts as a date.
      expect(period.startsAt > now).toBe(true);
      expect(period.endsAt > period.startsAt).toBe(true);
    }
  });

  it("does not duplicate venues or periods when run again (AC5)", async () => {
    // Scoped to the seed's own rows, because this file shares its container with
    // `venue-records.test.ts`, which creates and deletes its own venue in parallel.
    const seedNames = seedVenues.map(venue => venue.name);
    const seedIds = (
      await database
        .select({ id: schema.venues.id })
        .from(schema.venues)
        .where(inArray(schema.venues.name, seedNames))
    ).map(row => row.id);
    const countSeedPeriods = async () =>
      (
        await database
          .select()
          .from(schema.venueUnavailability)
          .where(inArray(schema.venueUnavailability.venueId, seedIds))
      ).length;

    const before = { venues: seedIds.length, periods: await countSeedPeriods() };

    await runSeed(database);
    await runSeed(database);

    const after = {
      venues: (
        await database.select().from(schema.venues).where(inArray(schema.venues.name, seedNames))
      ).length,
      periods: await countSeedPeriods(),
    };

    expect(after).toEqual(before);
    expect(before.venues).toBe(seedVenues.length);
    expect(before.periods).toBeGreaterThanOrEqual(seedVenueUnavailability.length);
  });
});
