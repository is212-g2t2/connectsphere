// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleGetVenueAvailability, handleSearchVenues } from "#/features/venues/records.server";
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

  it("shows an open-ended block as blocked with openEnded and an end clamped to the range (PTR-136)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: null,
        reason: "Integration open-ended works",
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
        label: "Integration open-ended works",
        startsAt: "2027-03-15T09:00:00",
        endsAt: "2027-03-16T00:00:00",
        visibleStart: "2027-03-15T09:00:00",
        visibleEnd: "2027-03-16T00:00:00",
        openEnded: true,
      },
    ]);
  });

  it("hides a lifted block from the schedule (PTR-136)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: "2027-03-15 11:00:00",
        reason: "Integration lifted works",
        liftedAt: new Date(),
      });
      return created;
    });

    const schedule = await handleGetVenueAvailability(
      { venueId: venue.id, startDate: "2027-03-15", endDate: "2027-03-15" },
      "",
      database as never
    );

    expect(schedule?.occupied).toEqual([]);
    expect(schedule?.available.map(period => [period.startsAt, period.endsAt])).toEqual([
      ["2027-03-15T08:00:00", "2027-03-15T22:00:00"],
    ]);
  });

  it("shows a finite block without openEnded (PTR-136)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: "2027-03-15 11:00:00",
        reason: "Integration finite works",
      });
      return created;
    });

    const schedule = await handleGetVenueAvailability(
      { venueId: venue.id, startDate: "2027-03-15", endDate: "2027-03-15" },
      "",
      database as never
    );

    expect(schedule?.occupied).toHaveLength(1);
    expect(schedule?.occupied[0]).toMatchObject({ state: "blocked" });
    expect(schedule?.occupied[0]?.openEnded).toBeUndefined();
  });

  it("keeps the real end of a finite block that extends past the range (PTR-136)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: "2027-03-20 11:00:00",
        reason: "Integration extended works",
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
        label: "Integration extended works",
        startsAt: "2027-03-15T09:00:00",
        endsAt: "2027-03-20T11:00:00",
        visibleStart: "2027-03-15T09:00:00",
        visibleEnd: "2027-03-16T00:00:00",
      },
    ]);
  });

  it("refuses a far-future window covered by an open-ended block, naming the reason (PTR-136)", async () => {
    const venue = await database.transaction(async tx => {
      const [created] = await tx.insert(schema.venues).values(record).returning();
      await tx.insert(schema.venueUnavailability).values({
        venueId: created.id,
        startsAt: "2027-03-15 09:00:00",
        endsAt: null,
        reason: "Integration open-ended works",
      });
      return created;
    });
    // 2027-04-20 is a Tuesday, weeks after the block starts, so only the open end covers it.
    const viewer: SessionUser = {
      id: "venue-availability-viewer",
      email: "venue-availability-viewer@example.invalid",
      name: "Venue Availability Viewer",
      role: "event_coordinator",
    };

    const result = await handleSearchVenues(
      { date: "2027-04-20", startTime: "10:00", endTime: "12:00" },
      viewer,
      database as never
    );

    expect(result.unsuitable.find(entry => entry.venue.id === venue.id)?.failures).toEqual([
      {
        criterion: "availability",
        message: "Unavailable on 2027-04-20: Integration open-ended works",
      },
    ]);
    expect(result.venues.map(entry => entry.id)).not.toContain(venue.id);
  });
});
