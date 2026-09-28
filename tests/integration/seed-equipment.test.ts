// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed, seedEquipmentTypes, seedEquipmentUnavailability } from "../../scripts/seed";

describe("seeded equipment inventory (PTR-115)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("holds at least three named equipment types with positive quantities (AC1)", async () => {
    const rows = await database
      .select()
      .from(schema.equipmentTypes)
      .where(
        inArray(
          schema.equipmentTypes.name,
          seedEquipmentTypes.map(type => type.name)
        )
      );

    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const type of rows) {
      expect(type.name).not.toBe("");
      expect(type.quantityHeld).toBeGreaterThan(0);
    }
  });

  it("records unavailable units while leaving units available (AC2)", async () => {
    const types = await database
      .select({
        id: schema.equipmentTypes.id,
        quantityHeld: schema.equipmentTypes.quantityHeld,
      })
      .from(schema.equipmentTypes)
      .where(
        inArray(
          schema.equipmentTypes.name,
          seedEquipmentUnavailability.map(record => record.equipmentTypeName)
        )
      );
    const heldById = new Map(types.map(type => [type.id, type.quantityHeld]));
    const unavailable = await database
      .select()
      .from(schema.equipmentUnavailability)
      .where(inArray(schema.equipmentUnavailability.equipmentTypeId, [...heldById.keys()]));

    expect(unavailable.length).toBeGreaterThanOrEqual(1);
    for (const record of unavailable) {
      const quantityHeld = heldById.get(record.equipmentTypeId);
      if (quantityHeld === undefined) {
        throw new Error(`Missing held quantity for equipment type ${record.equipmentTypeId}`);
      }
      expect(record.quantityUnavailable).toBeGreaterThan(0);
      expect(record.quantityUnavailable).toBeLessThan(quantityHeld);
    }
  });

  it("does not duplicate equipment types or unavailable units on re-seed (AC3)", async () => {
    const seedNames = seedEquipmentTypes.map(type => type.name);
    const countInventory = async () => {
      const types = await database
        .select({ id: schema.equipmentTypes.id })
        .from(schema.equipmentTypes)
        .where(inArray(schema.equipmentTypes.name, seedNames));
      const unavailable = await database
        .select()
        .from(schema.equipmentUnavailability)
        .where(
          inArray(
            schema.equipmentUnavailability.equipmentTypeId,
            types.map(type => type.id)
          )
        );
      return { types: types.length, unavailable: unavailable.length };
    };

    const before = await countInventory();
    await runSeed(database);

    expect(await countInventory()).toEqual(before);
    expect(before).toEqual({
      types: seedEquipmentTypes.length,
      unavailable: seedEquipmentUnavailability.length,
    });
  });
});
