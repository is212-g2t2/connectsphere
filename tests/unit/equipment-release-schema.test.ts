import { describe, expect, it } from "vitest";

import {
  ARRANGEMENT_REASON_LENGTH_MESSAGE,
  EQUIPMENT_NOTES_MAX,
  RELEASE_TOTAL_MESSAGE,
  ReleaseEquipmentFormInput,
  parseReleaseEquipmentInput,
} from "#/features/equipment-requests/schema";

describe("ReleaseEquipmentInput (PTR-42 AC1)", () => {
  it("accepts a release and a reduction, with or without a reason", () => {
    expect(parseReleaseEquipmentInput({ equipmentRequestId: "line-1", quantity: 0 })).toEqual({
      equipmentRequestId: "line-1",
      quantity: 0,
    });
    expect(
      parseReleaseEquipmentInput({
        equipmentRequestId: "line-1",
        quantity: 2,
        unavailableReason: "  Amplifier failed inspection  ",
      })
    ).toEqual({
      equipmentRequestId: "line-1",
      quantity: 2,
      unavailableReason: "Amplifier failed inspection",
    });
  });

  it.each([-1, 1.5, Number.NaN, "2", undefined])("refuses the total %p", quantity => {
    expect(() => parseReleaseEquipmentInput({ equipmentRequestId: "line-1", quantity })).toThrow(
      RELEASE_TOTAL_MESSAGE
    );
  });

  it("refuses a reason over the limit, naming the reason", () => {
    expect(() =>
      parseReleaseEquipmentInput({
        equipmentRequestId: "line-1",
        quantity: 0,
        unavailableReason: "x".repeat(EQUIPMENT_NOTES_MAX + 1),
      })
    ).toThrow(ARRANGEMENT_REASON_LENGTH_MESSAGE);
  });

  it("requires a line id", () => {
    expect(() => parseReleaseEquipmentInput({ equipmentRequestId: " ", quantity: 0 })).toThrow(
      "Equipment request ID is required"
    );
  });
});

describe("ReleaseEquipmentFormInput", () => {
  it("converts the string leaves and drops a blank reason", () => {
    expect(ReleaseEquipmentFormInput.parse({ quantity: "0", unavailableReason: "" })).toEqual({
      quantity: 0,
    });
    expect(
      ReleaseEquipmentFormInput.parse({ quantity: "3", unavailableReason: "Unit recalled" })
    ).toEqual({ quantity: 3, unavailableReason: "Unit recalled" });
  });

  it.each(["", "-1", "1.5", "abc"])("marks the quantity for %j", quantity => {
    const result = ReleaseEquipmentFormInput.safeParse({ quantity, unavailableReason: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["quantity"],
      message: RELEASE_TOTAL_MESSAGE,
    });
  });
});
