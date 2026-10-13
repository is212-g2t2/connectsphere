// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Delete only rows created by this file. Keep seeded venues for seed tests.
    await database.delete(schema.venues).where(eq(schema.venues.name, record.name));
  });

  it("creates a record and then edits it (AC1)", async () => {
    const created = await handleSaveVenue(record, database as never, "venue-record-test-staff");
    expect(created).toMatchObject(record);
    expect(created.id).toBeGreaterThan(0);

    // Inserts use the database clock and updates use the application clock. Control the application
    // clock so host/container skew does not fail a correct edit.
    const editedAt = new Date(created.updatedAt.getTime() + 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(editedAt);
    try {
      const updated = await handleSaveVenue(
        { ...record, id: created.id, maxCapacity: 75, facilities: ["Projector", "Whiteboard"] },
        database as never,
        "venue-record-test-staff"
      );
      expect(updated.id).toBe(created.id);
      expect(updated.maxCapacity).toBe(75);
      expect(updated.facilities).toEqual(["Projector", "Whiteboard"]);
      expect(updated.updatedAt).toEqual(editedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the edited values on the next read, with no stale copy (AC5)", async () => {
    const created = await handleSaveVenue(record, database as never, "venue-record-test-staff");
    await handleSaveVenue(
      { ...record, id: created.id, maxCapacity: 90 },
      database as never,
      "venue-record-test-staff"
    );

    const fetched = await handleGetVenue({ id: created.id }, database as never);
    expect(fetched?.maxCapacity).toBe(90);

    const listed = await handleListVenues(database as never);
    expect(listed.find(venue => venue.id === created.id)?.maxCapacity).toBe(90);
  });

  /** Test AC3 at the persistence layer, including the CHECK constraint behind the Zod schema. */
  it("refuses a capacity that is not a positive whole number (AC3)", async () => {
    await Promise.all(
      [0, -5, 2.5, "60"].map(maxCapacity =>
        expect(
          handleSaveVenue({ ...record, maxCapacity }, database as never, "venue-record-test-staff")
        ).rejects.toThrow(CAPACITY_MESSAGE)
      )
    );

    // Drizzle wraps the driver error. The constraint name is in `cause`, not the message.
    await expect(
      database.insert(schema.venues).values({ ...record, maxCapacity: 0 })
    ).rejects.toMatchObject({ cause: { constraint: "venues_max_capacity_positive" } });
  });

  // Venue Staff have `venue:update`. A missing row must return not found, not 403, or the form
  // would report a permission error for a mistyped id.
  it("reports an update to a venue that does not exist as not found", async () => {
    await expect(
      handleSaveVenue({ ...record, id: 999_999 }, database as never, "venue-record-test-staff")
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
  });

  it("refuses a second venue with the same name, in words the form can show", async () => {
    await handleSaveVenue(record, database as never, "venue-record-test-staff");
    await expect(
      handleSaveVenue(record, database as never, "venue-record-test-staff")
    ).rejects.toThrow(DUPLICATE_NAME_MESSAGE);
  });

  it("refuses renaming a venue onto a name another venue holds", async () => {
    const created = await handleSaveVenue(record, database as never, "venue-record-test-staff");
    await expect(
      handleSaveVenue(
        { ...record, id: created.id, name: "Harbour Hall" },
        database as never,
        "venue-record-test-staff"
      )
    ).rejects.toThrow(DUPLICATE_NAME_MESSAGE);
  });

  it("returns null for an id that no venue holds", async () => {
    expect(await handleGetVenue({ id: 999_999 }, database as never)).toBeNull();
  });

  it("stores zero defaults and records each buffer change with its actor and time (PTR-131)", async () => {
    const created = await handleSaveVenue(record, database as never, "staff-one");
    expect(created).toMatchObject({ setupMinutes: 0, turnaroundMinutes: 0 });
    const first = await handleSaveVenue(
      { ...created, setupMinutes: 30, turnaroundMinutes: 45 },
      database as never,
      "staff-one"
    );
    await handleSaveVenue({ ...first, turnaroundMinutes: 60 }, database as never, "staff-two");
    const changes = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, created.id))
      .orderBy(schema.venueBufferChanges.id);
    expect(changes).toMatchObject([
      {
        previousSetupMinutes: 0,
        previousTurnaroundMinutes: 0,
        setupMinutes: 30,
        turnaroundMinutes: 45,
        changedById: "staff-one",
      },
      {
        previousSetupMinutes: 30,
        previousTurnaroundMinutes: 45,
        setupMinutes: 30,
        turnaroundMinutes: 60,
        changedById: "staff-two",
      },
    ]);
    expect(changes.every(change => change.changedAt instanceof Date)).toBe(true);
    expect(await handleGetVenue({ id: created.id }, database as never)).toMatchObject({
      setupMinutes: 30,
      turnaroundMinutes: 60,
    });
  });

  it("audits nonzero initial buffers and skips unrelated edits and unchanged saves", async () => {
    const created = await handleSaveVenue(
      { ...record, setupMinutes: 15 },
      database as never,
      "staff-one"
    );
    await handleSaveVenue({ ...created, location: "New location" }, database as never, "staff-two");
    const changes = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, created.id));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      previousSetupMinutes: 0,
      setupMinutes: 15,
      changedById: "staff-one",
    });
  });

  it("records the committed predecessor when buffer edits run concurrently", async () => {
    const created = await handleSaveVenue(record, database as never, "staff-one");
    await Promise.all([
      handleSaveVenue(
        { ...created, setupMinutes: 10, turnaroundMinutes: 20 },
        database as never,
        "staff-one"
      ),
      handleSaveVenue(
        { ...created, setupMinutes: 30, turnaroundMinutes: 40 },
        database as never,
        "staff-two"
      ),
    ]);
    const changes = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, created.id))
      .orderBy(schema.venueBufferChanges.id);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ previousSetupMinutes: 0, previousTurnaroundMinutes: 0 });
    expect(changes[1]).toMatchObject({
      previousSetupMinutes: changes[0].setupMinutes,
      previousTurnaroundMinutes: changes[0].turnaroundMinutes,
    });
  });

  it("keeps the record and its audit unchanged when a save fails", async () => {
    const created = await handleSaveVenue(record, database as never, "staff-one");
    await expect(
      handleSaveVenue(
        { ...created, name: "Harbour Hall", setupMinutes: 30 },
        database as never,
        "staff-two"
      )
    ).rejects.toThrow(DUPLICATE_NAME_MESSAGE);
    expect(await handleGetVenue({ id: created.id }, database as never)).toMatchObject({
      setupMinutes: 0,
    });
    expect(
      await database
        .select()
        .from(schema.venueBufferChanges)
        .where(eq(schema.venueBufferChanges.venueId, created.id))
    ).toHaveLength(0);
  });

  it.each(["setupMinutes", "turnaroundMinutes"] as const)(
    "rejects invalid %s without changing the venue",
    async field => {
      const created = await handleSaveVenue(record, database as never, "staff-one");
      await Promise.all(
        [-1, 1.5].map(value =>
          expect(
            handleSaveVenue({ ...created, [field]: value }, database as never, "staff-two")
          ).rejects.toThrow(/time must be whole minutes/)
        )
      );
      await expect(
        database
          .update(schema.venues)
          .set({ [field]: -1 })
          .where(eq(schema.venues.id, created.id))
      ).rejects.toMatchObject({
        cause: {
          constraint:
            field === "setupMinutes"
              ? "venues_setup_minutes_nonnegative"
              : "venues_turnaround_minutes_nonnegative",
        },
      });
    }
  );
});
