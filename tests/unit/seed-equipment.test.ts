import { describe, expect, it } from "vitest";

import { seedEquipmentTypes, seedEquipmentUnavailability } from "../../scripts/seed";

describe("equipment seed data (PTR-115)", () => {
  it("defines at least three unique named types with positive held quantities (AC1)", () => {
    expect(seedEquipmentTypes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seedEquipmentTypes.map(type => type.name)).size).toBe(seedEquipmentTypes.length);
    for (const type of seedEquipmentTypes) {
      expect(type.name).not.toBe("");
      expect(type.quantityHeld).toBeGreaterThan(0);
    }
  });

  it("leaves held units after subtracting every seeded unavailable quantity (AC2)", () => {
    const heldByName = new Map(
      seedEquipmentTypes.map(type => [type.name, type.quantityHeld] as const)
    );

    expect(seedEquipmentUnavailability.length).toBeGreaterThanOrEqual(1);
    for (const record of seedEquipmentUnavailability) {
      const quantityHeld = heldByName.get(record.equipmentTypeName);
      if (quantityHeld === undefined) {
        throw new Error(`Unknown seed equipment type "${record.equipmentTypeName}"`);
      }
      expect(record.quantityUnavailable).toBeGreaterThan(0);
      expect(record.quantityUnavailable).toBeLessThan(quantityHeld);
    }
  });
});
