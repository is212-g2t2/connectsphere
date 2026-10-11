// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/** 2027-03-15 is a Monday. `DEFAULT_OPERATING_HOURS` opens it from 08:00 to 22:00. */
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
    // Delete only rows from this file. Keep seeded venues for seed tests. Blocks cascade on delete.
    await database.delete(schema.venues).where(eq(schema.venues.name, record.name));
  });

  /** Unit tests cannot cover this database path. PostgreSQL returns `timestamp without time zone`
   * as `"2027-03-15 09:00:00"`. The calendar must normalize it to the local `T` form and subtract
   * it from venue hours without creating a `Date`.
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
      "",
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

  // Match `$venueId.tsx`: return null for a missing row so the route can call `notFound()` instead
  // of sending a 404 through the error boundary.
  it("answers null for a venue that does not exist", async () => {
    expect(
      await handleGetVenueAvailability(
        { venueId: 999_999, startDate: "2027-03-15", endDate: "2027-03-15" },
        "",
        database as never
      )
    ).toBeNull();
  });
});
