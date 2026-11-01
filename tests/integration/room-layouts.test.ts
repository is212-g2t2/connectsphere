// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import {
  handleDeleteRoomLayout,
  handleListRoomLayouts,
  handleSaveRoomLayout,
} from "#/features/venues/layouts.server";
import { handleSaveVenue, handleSearchVenues } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS, LAYOUT_MESSAGE } from "#/features/venues/schema";

const VENUE = "PTR-161 Layout Hall";

describe("Room layout list (PTR-161)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("ships the six current layouts under their current keys", async () => {
    const layouts = await handleListRoomLayouts(database);
    expect(layouts.map(layout => layout.key).toSorted()).toEqual(
      ["banquet", "boardroom", "classroom", "exhibition", "other", "theatre"].toSorted()
    );
    expect(layouts.find(layout => layout.key === "theatre")?.label).toBe("Theatre");
  });

  it("adds a layout type that venues can then use", async () => {
    await database.delete(schema.roomLayouts).where(eq(schema.roomLayouts.key, "ptr161-cabaret"));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));

    const saved = await handleSaveRoomLayout(
      { key: "ptr161-cabaret", label: "PTR-161 Cabaret" },
      database as never
    );
    expect(saved).toMatchObject({ key: "ptr161-cabaret", label: "PTR-161 Cabaret" });

    const venue = await handleSaveVenue(
      {
        name: VENUE,
        location: "Level 9",
        maxCapacity: 80,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: ["ptr161-cabaret"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      },
      database as never,
      "room-layout-test-staff"
    );
    expect(venue.supportedLayouts).toEqual(["ptr161-cabaret"]);

    const search = await handleSearchVenues(
      { layout: "ptr-161 cabaret seating" },
      { id: "coordinator", email: "c@example.com", role: "event_coordinator" },
      database as never
    );
    expect(search.layouts.map(layout => layout.key)).toContain("ptr161-cabaret");
    expect(search.venues.map(item => item.name)).toContain(VENUE);

    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));
    await handleDeleteRoomLayout({ key: "ptr161-cabaret" }, database as never);
    const after = await handleListRoomLayouts(database);
    expect(after.map(layout => layout.key)).not.toContain("ptr161-cabaret");
  });

  it("renames a layout while venues keep it under the new label", async () => {
    await database.delete(schema.roomLayouts).where(eq(schema.roomLayouts.key, "ptr161-fishbowl"));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));

    await handleSaveRoomLayout(
      { key: "ptr161-fishbowl", label: "PTR-161 Fishbowl" },
      database as never
    );
    await handleSaveVenue(
      {
        name: VENUE,
        location: "Level 9",
        maxCapacity: 80,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: ["ptr161-fishbowl"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      },
      database as never,
      "room-layout-test-staff"
    );

    const renamed = await handleSaveRoomLayout(
      { key: "ptr161-fishbowl", label: "PTR-161 Bowl" },
      database as never
    );
    expect(renamed.label).toBe("PTR-161 Bowl");

    const rows = await database
      .select({ supportedLayouts: schema.venues.supportedLayouts })
      .from(schema.venues)
      .where(eq(schema.venues.name, VENUE));
    expect(rows.at(0)?.supportedLayouts).toEqual(["ptr161-fishbowl"]);

    const search = await handleSearchVenues(
      { layout: "ptr-161 bowl seating" },
      { id: "coordinator", email: "c@example.com", role: "event_coordinator" },
      database as never
    );
    expect(search.venues.map(item => item.name)).toContain(VENUE);

    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));
    await handleDeleteRoomLayout({ key: "ptr161-fishbowl" }, database as never);
  });

  it("refuses an unknown layout key with the named message", async () => {
    await expect(
      handleSaveVenue(
        {
          name: VENUE,
          location: "Level 9",
          maxCapacity: 80,
          facilities: [],
          accessibilityFeatures: [],
          supportedLayouts: ["ptr161-no-such-layout"],
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        database as never,
        "room-layout-test-staff"
      )
    ).rejects.toThrow(LAYOUT_MESSAGE);
  });

  it("refuses to delete a layout that a venue supports, and names the venue", async () => {
    await database.delete(schema.roomLayouts).where(eq(schema.roomLayouts.key, "ptr161-kept"));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));

    await handleSaveRoomLayout({ key: "ptr161-kept", label: "PTR-161 Kept" }, database as never);
    await handleSaveVenue(
      {
        name: VENUE,
        location: "Level 9",
        maxCapacity: 80,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: ["ptr161-kept"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      },
      database as never,
      "room-layout-test-staff"
    );

    await expect(handleDeleteRoomLayout({ key: "ptr161-kept" }, database as never)).rejects.toThrow(
      VENUE
    );

    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE));
    await handleDeleteRoomLayout({ key: "ptr161-kept" }, database as never);
  });

  it("refuses a search filter that names no maintained layout", async () => {
    await expect(
      handleSearchVenues(
        { layout: "ptr161 stadium" },
        { id: "coordinator", email: "c@example.com", role: "event_coordinator" },
        database as never
      )
    ).rejects.toThrow(LAYOUT_MESSAGE);
  });

  it("keeps existing venues valid after the change", async () => {
    const rows = await database
      .select({ name: schema.venues.name, supportedLayouts: schema.venues.supportedLayouts })
      .from(schema.venues)
      .where(sql`cardinality(${schema.venues.supportedLayouts}) > 0`)
      .limit(5);
    expect(rows.length).toBeGreaterThan(0);
    const known = new Set((await handleListRoomLayouts(database)).map(layout => layout.key));
    for (const row of rows) {
      expect(row.supportedLayouts.every(key => known.has(key))).toBe(true);
    }
  });
});
