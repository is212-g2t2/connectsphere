// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleGetVenue,
  handleListVenues,
  handleSaveVenue,
} from "#/features/venues/records.server";
import { CAPACITY_MESSAGE, DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

const venueStaff: SessionUser = {
  id: "seed-venue-staff-1",
  email: "venue.staff.seed@example.com",
  role: "venue_staff",
};
const coordinator: SessionUser = {
  id: "seed-coordinator-1",
  email: "coordinator.seed@example.com",
  role: "event_coordinator",
};
const organiser: SessionUser = {
  id: "test-user-2",
  email: "jane.doe@example.com",
  role: "event_organiser",
};

const record = {
  name: "Integration Studio",
  location: "Level 3, ConnectSphere Tower",
  maxCapacity: 60,
  facilities: ["Projector"],
  accessibilityFeatures: ["Lift access"],
  supportedLayouts: ["classroom" as const],
  operatingHours: DEFAULT_OPERATING_HOURS,
};

describe("Venue records (PTR-26)", () => {
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
    // Only what this file creates; the seeded venues stay for the seed tests.
    await database.delete(schema.venues).where(eq(schema.venues.name, record.name));
  });

  it("lets Venue Staff create a record and then edit it (AC1)", async () => {
    const created = await handleSaveVenue(record, venueStaff, database as never);
    expect(created).toMatchObject(record);
    expect(created.id).toBeGreaterThan(0);

    const updated = await handleSaveVenue(
      { ...record, id: created.id, maxCapacity: 75, facilities: ["Projector", "Whiteboard"] },
      venueStaff,
      database as never
    );
    expect(updated.id).toBe(created.id);
    expect(updated.maxCapacity).toBe(75);
    expect(updated.facilities).toEqual(["Projector", "Whiteboard"]);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("serves the edited values on the next read, with no stale copy (AC5)", async () => {
    const created = await handleSaveVenue(record, venueStaff, database as never);
    await handleSaveVenue(
      { ...record, id: created.id, maxCapacity: 90 },
      venueStaff,
      database as never
    );

    const fetched = await handleGetVenue({ id: created.id }, coordinator, database as never);
    expect(fetched?.maxCapacity).toBe(90);

    const listed = await handleListVenues(coordinator, database as never);
    expect(listed.find(venue => venue.id === created.id)?.maxCapacity).toBe(90);
  });

  /** AC3 at the persistence layer, including the CHECK constraint behind the Zod schema. */
  it("refuses a capacity that is not a positive whole number (AC3)", async () => {
    await Promise.all(
      [0, -5, 2.5, "60"].map(maxCapacity =>
        expect(
          handleSaveVenue({ ...record, maxCapacity }, venueStaff, database as never)
        ).rejects.toThrow(CAPACITY_MESSAGE)
      )
    );

    // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
    await expect(
      database.insert(schema.venues).values({ ...record, maxCapacity: 0 })
    ).rejects.toMatchObject({ cause: { constraint: "venues_max_capacity_positive" } });
  });

  it("refuses a Coordinator any write but lets them read (AC4)", async () => {
    const created = await handleSaveVenue(record, venueStaff, database as never);

    await expect(handleSaveVenue(record, coordinator, database as never)).rejects.toMatchObject({
      message: "Forbidden",
      status: 403,
    });
    await expect(
      handleSaveVenue({ ...record, id: created.id }, coordinator, database as never)
    ).rejects.toMatchObject({ message: "Forbidden", status: 403 });

    const fetched = await handleGetVenue({ id: created.id }, coordinator, database as never);
    expect(fetched?.name).toBe(record.name);
  });

  it("refuses an external role both reading and writing (AC4)", async () => {
    await expect(handleListVenues(organiser, database as never)).rejects.toMatchObject({
      status: 403,
    });
    await expect(handleGetVenue({ id: 1 }, organiser, database as never)).rejects.toMatchObject({
      status: 403,
    });
    await expect(handleSaveVenue(record, organiser, database as never)).rejects.toMatchObject({
      status: 403,
    });
    await expect(handleListVenues(null, database as never)).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    });
  });

  it("refuses an update to a venue that does not exist", async () => {
    await expect(
      handleSaveVenue({ ...record, id: 999_999 }, venueStaff, database as never)
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a second venue with the same name", async () => {
    await handleSaveVenue(record, venueStaff, database as never);
    await expect(handleSaveVenue(record, venueStaff, database as never)).rejects.toMatchObject({
      cause: { constraint: "venues_name_unique" },
    });
  });

  it("returns null for an id that no venue holds", async () => {
    expect(await handleGetVenue({ id: 999_999 }, coordinator, database as never)).toBeNull();
  });
});
