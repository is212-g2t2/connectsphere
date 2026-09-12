// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
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
    const before = {
      venues: (await database.select().from(schema.venues)).length,
      periods: (await database.select().from(schema.venueUnavailability)).length,
    };

    await runSeed(database);
    await runSeed(database);

    expect((await database.select().from(schema.venues)).length).toBe(before.venues);
    expect((await database.select().from(schema.venueUnavailability)).length).toBe(before.periods);
    expect(before.venues).toBeGreaterThanOrEqual(seedVenues.length);
    expect(before.periods).toBeGreaterThanOrEqual(seedVenueUnavailability.length);
  });
});
