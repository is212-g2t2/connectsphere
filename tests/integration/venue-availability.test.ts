// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/** 2027-03-15 is a Monday, so `DEFAULT_OPERATING_HOURS` opens it 08:00–22:00. */
const record = {
  name: "Integration Arena",
  location: "Level 1, ConnectSphere Tower",
  maxCapacity: 120,
  facilities: [],
  accessibilityFeatures: [],
  supportedLayouts: [],
  operatingHours: DEFAULT_OPERATING_HOURS,
};

describe("Venue availability (PTR-28)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Only what this file creates; the seeded venues stay for the seed tests. Blocks cascade.
    await database.delete(schema.venues).where(eq(schema.venues.name, record.name));
  });

  /**
   * The one path the unit tests cannot cover: Postgres hands `timestamp without time zone` back
   * as `"2027-03-15 09:00:00"`, and the calendar must normalise it to the floating `T` form and
   * subtract it from the venue's opening hours without ever building a `Date`.
   */
  it("round-trips a recorded block into the schedule for its exact period (AC4)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: "2027-03-15 11:00:00",
        reason: "Integration maintenance",
      });
      return created;
    });

    const schedule = await handleGetVenueAvailability(
      { venueId: venue.id, startDate: "2027-03-15", endDate: "2027-03-15" },
      database as never
    );

    expect(schedule?.occupied).toEqual([
      {
        id: expect.any(String) as string,
        state: "blocked",
        label: "Integration maintenance",
        startsAt: "2027-03-15T09:00:00",
        endsAt: "2027-03-15T11:00:00",
        visibleStart: "2027-03-15T09:00:00",
        visibleEnd: "2027-03-15T11:00:00",
      },
    ]);
    expect(schedule?.available.map(period => [period.startsAt, period.endsAt])).toEqual([
      ["2027-03-15T08:00:00", "2027-03-15T09:00:00"],
      ["2027-03-15T11:00:00", "2027-03-15T22:00:00"],
    ]);
  });

  // The read convention `$venueId.tsx` uses: a missing row is `null` for the route to turn into
  // the router's `notFound()`, not a 404 the loader would surface through the error boundary.
  it("answers null for a venue that does not exist", async () => {
    expect(
      await handleGetVenueAvailability(
        { venueId: 999_999, startDate: "2027-03-15", endDate: "2027-03-15" },
        database as never
      )
    ).toBeNull();
  });
});
