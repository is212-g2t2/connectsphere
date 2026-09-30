import { describe, expect, it } from "vitest";

import {
  ARRANGEMENT_REASON_LENGTH_MESSAGE,
  EQUIPMENT_NOTES_MAX,
  RELEASE_REASON_NEEDS_RELEASE_MESSAGE,
  RELEASE_TOTAL_MESSAGE,
  ReleaseEquipmentFormInput,
  parseReleaseEquipmentInput,
} from "#/features/equipment-requests/schema";

describe("ReleaseEquipmentInput (PTR-42 AC1)", () => {
  it("accepts a release with or without a reason, and a reduction without one", () => {
    expect(parseReleaseEquipmentInput({ equipmentRequestId: "line-1", quantity: 0 })).toEqual({
      equipmentRequestId: "line-1",
      quantity: 0,
    });
    expect(parseReleaseEquipmentInput({ equipmentRequestId: "line-1", quantity: 2 })).toEqual({
      equipmentRequestId: "line-1",
      quantity: 2,
    });
    expect(
      parseReleaseEquipmentInput({
        equipmentRequestId: "line-1",
        quantity: 0,
        unavailableReason: "  Amplifier failed inspection  ",
      })
    ).toEqual({
      equipmentRequestId: "line-1",
      quantity: 0,
      unavailableReason: "Amplifier failed inspection",
    });
  });

  it("refuses a reason on a reduction: an unavailable line must hold nothing", () => {
    expect(() =>
      parseReleaseEquipmentInput({
        equipmentRequestId: "line-1",
        quantity: 2,
        unavailableReason: "Amplifier failed inspection",
      })
    ).toThrow(RELEASE_REASON_NEEDS_RELEASE_MESSAGE);
    // A blank reason on a reduction is no reason at all.
    expect(
      parseReleaseEquipmentInput({
        equipmentRequestId: "line-1",
        quantity: 2,
        unavailableReason: " ",
      })
    ).toMatchObject({ quantity: 2 });
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
      ReleaseEquipmentFormInput.parse({ quantity: "0", unavailableReason: "Unit recalled" })
    ).toEqual({ quantity: 0, unavailableReason: "Unit recalled" });
    expect(ReleaseEquipmentFormInput.parse({ quantity: "3", unavailableReason: "" })).toEqual({
      quantity: 3,
    });
  });

  it("marks the reason field when a reason comes with a reduction", () => {
    const result = ReleaseEquipmentFormInput.safeParse({
      quantity: "1",
      unavailableReason: "Recalled",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["unavailableReason"],
      message: RELEASE_REASON_NEEDS_RELEASE_MESSAGE,
    });
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
