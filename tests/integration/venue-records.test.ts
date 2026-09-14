// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import {
  handleGetVenue,
  handleListVenues,
  handleSaveVenue,
} from "#/features/venues/records.server";
import {
  CAPACITY_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  DUPLICATE_NAME_MESSAGE,
} from "#/features/venues/schema";

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

  it("creates a record and then edits it (AC1)", async () => {
    const created = await handleSaveVenue(record, database as never);
    expect(created).toMatchObject(record);
    expect(created.id).toBeGreaterThan(0);

    const updated = await handleSaveVenue(
      { ...record, id: created.id, maxCapacity: 75, facilities: ["Projector", "Whiteboard"] },
      database as never
    );
    expect(updated.id).toBe(created.id);
    expect(updated.maxCapacity).toBe(75);
    expect(updated.facilities).toEqual(["Projector", "Whiteboard"]);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it("serves the edited values on the next read, with no stale copy (AC5)", async () => {
    const created = await handleSaveVenue(record, database as never);
    await handleSaveVenue({ ...record, id: created.id, maxCapacity: 90 }, database as never);

    const fetched = await handleGetVenue({ id: created.id }, database as never);
    expect(fetched?.maxCapacity).toBe(90);

    const listed = await handleListVenues(database as never);
    expect(listed.find(venue => venue.id === created.id)?.maxCapacity).toBe(90);
  });

  /** AC3 at the persistence layer, including the CHECK constraint behind the Zod schema. */
  it("refuses a capacity that is not a positive whole number (AC3)", async () => {
    await Promise.all(
      [0, -5, 2.5, "60"].map(maxCapacity =>
        expect(handleSaveVenue({ ...record, maxCapacity }, database as never)).rejects.toThrow(
          CAPACITY_MESSAGE
        )
      )
    );

    // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
    await expect(
      database.insert(schema.venues).values({ ...record, maxCapacity: 0 })
    ).rejects.toMatchObject({ cause: { constraint: "venues_max_capacity_positive" } });
  });

  // Venue Staff hold `venue:update`, so a row that is not there is a missing record and not a
  // refusal — 403 here would have the form tell them their role forbade an id they mistyped.
  it("reports an update to a venue that does not exist as not found", async () => {
    await expect(
      handleSaveVenue({ ...record, id: 999_999 }, database as never)
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
  });

  it("refuses a second venue with the same name, in words the form can show", async () => {
    await handleSaveVenue(record, database as never);
    await expect(handleSaveVenue(record, database as never)).rejects.toThrow(
      DUPLICATE_NAME_MESSAGE
    );
  });

  it("refuses renaming a venue onto a name another venue holds", async () => {
    const created = await handleSaveVenue(record, database as never);
    await expect(
      handleSaveVenue({ ...record, id: created.id, name: "Harbour Hall" }, database as never)
    ).rejects.toThrow(DUPLICATE_NAME_MESSAGE);
  });

  it("returns null for an id that no venue holds", async () => {
    expect(await handleGetVenue({ id: 999_999 }, database as never)).toBeNull();
  });
});
