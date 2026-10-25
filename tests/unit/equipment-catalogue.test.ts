import { describe, expect, test } from "vitest";

import { computeEquipmentShortfalls } from "#/features/equipment-requests/availability";
import {
  EQUIPMENT_UNAVAILABLE_QUANTITY_MESSAGE,
  equipmentHeldBelowUnavailableMessage,
  equipmentUnavailabilityMissingMessage,
  parseEquipmentTypeInput,
  parseEquipmentUnavailabilityInput,
  parseMapEquipmentLineInput,
} from "#/features/equipment-requests/schema";

describe("equipment catalogue input (PTR-162)", () => {
  test("accepts a new type with a positive held quantity", () => {
    expect(parseEquipmentTypeInput({ name: "Projector", quantityHeld: 4 })).toEqual({
      name: "Projector",
      quantityHeld: 4,
    });
  });

  test("refuses a held quantity of zero or less", () => {
    expect(() => parseEquipmentTypeInput({ name: "Projector", quantityHeld: 0 })).toThrow(Error);
    expect(() => parseEquipmentTypeInput({ name: "Projector", quantityHeld: -2 })).toThrow(Error);
  });

  test("refuses a blank type name", () => {
    expect(() => parseEquipmentTypeInput({ name: "  ", quantityHeld: 4 })).toThrow(
      "Enter an equipment type"
    );
  });

  test("accepts an out-of-service quantity with a reason", () => {
    expect(
      parseEquipmentUnavailabilityInput({
        equipmentTypeId: 3,
        reason: "Maintenance",
        quantityUnavailable: 2,
      })
    ).toEqual({ equipmentTypeId: 3, reason: "Maintenance", quantityUnavailable: 2 });
  });

  test("refuses a blank out-of-service reason", () => {
    expect(() =>
      parseEquipmentUnavailabilityInput({
        equipmentTypeId: 3,
        reason: "   ",
        quantityUnavailable: 2,
      })
    ).toThrow("Enter a reason for the out-of-service units");
  });

  test("accepts zero to clear an out-of-service reason", () => {
    expect(
      parseEquipmentUnavailabilityInput({
        equipmentTypeId: 3,
        reason: "Maintenance",
        quantityUnavailable: 0,
      })
    ).toEqual({ equipmentTypeId: 3, reason: "Maintenance", quantityUnavailable: 0 });
  });

  test("refuses a negative out-of-service quantity", () => {
    expect(() =>
      parseEquipmentUnavailabilityInput({
        equipmentTypeId: 3,
        reason: "Maintenance",
        quantityUnavailable: -1,
      })
    ).toThrow(EQUIPMENT_UNAVAILABLE_QUANTITY_MESSAGE);
  });

  test("the held-path refusal names the blocking total", () => {
    expect(equipmentHeldBelowUnavailableMessage(2, 3)).toContain("3");
  });

  test("the missing-entry refusal names the reason", () => {
    expect(equipmentUnavailabilityMissingMessage("Repair")).toBe(
      "No out-of-service entry for Repair."
    );
  });

  test("accepts a line-to-type mapping", () => {
    expect(parseMapEquipmentLineInput({ eventId: 7, id: "line-1", equipmentTypeId: 3 })).toEqual({
      eventId: 7,
      id: "line-1",
      equipmentTypeId: 3,
    });
  });
});

describe("computeEquipmentShortfalls (PTR-162 AC3)", () => {
  const window = { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 12:00:00" };

  test("no shortfall when the peak fits the capacity", () => {
    const shortfalls = computeEquipmentShortfalls({
      capacities: new Map([[1, 10]]),
      reservations: [{ equipmentRequestId: "a", equipmentTypeId: 1, ...window, quantity: 3 }],
    });
    expect(shortfalls.get("a")).toBe(0);
  });

  test("short by the peak minus the capacity when overbooked", () => {
    const shortfalls = computeEquipmentShortfalls({
      capacities: new Map([[1, 5]]),
      reservations: [
        { equipmentRequestId: "a", equipmentTypeId: 1, ...window, quantity: 4 },
        {
          equipmentRequestId: "b",
          equipmentTypeId: 1,
          startsAt: "2030-01-01 11:00:00",
          endsAt: "2030-01-01 13:00:00",
          quantity: 3,
        },
      ],
    });
    expect(shortfalls.get("a")).toBe(2);
    expect(shortfalls.get("b")).toBe(2);
  });

  test("touching windows do not overlap", () => {
    const shortfalls = computeEquipmentShortfalls({
      capacities: new Map([[1, 4]]),
      reservations: [
        {
          equipmentRequestId: "a",
          equipmentTypeId: 1,
          startsAt: "2030-01-01 10:00:00",
          endsAt: "2030-01-01 11:00:00",
          quantity: 4,
        },
        {
          equipmentRequestId: "b",
          equipmentTypeId: 1,
          startsAt: "2030-01-01 11:00:00",
          endsAt: "2030-01-01 12:00:00",
          quantity: 4,
        },
      ],
    });
    expect(shortfalls.get("a")).toBe(0);
    expect(shortfalls.get("b")).toBe(0);
  });

  test("each type counts separately", () => {
    const shortfalls = computeEquipmentShortfalls({
      capacities: new Map([
        [1, 2],
        [2, 10],
      ]),
      reservations: [
        { equipmentRequestId: "a", equipmentTypeId: 1, ...window, quantity: 5 },
        { equipmentRequestId: "b", equipmentTypeId: 2, ...window, quantity: 5 },
      ],
    });
    expect(shortfalls.get("a")).toBe(3);
    expect(shortfalls.get("b")).toBe(0);
  });
});
