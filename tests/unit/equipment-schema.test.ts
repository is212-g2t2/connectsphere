import { describe, expect, test } from "vitest";

import {
  EQUIPMENT_NOTES_MAX,
  EquipmentLineFormInput,
  EquipmentLineInput,
  isEquipmentEditableStatus,
  parseEquipmentLineInput,
  parseRemoveEquipmentLineInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";
import { EQUIPMENT_TYPE_MAX_LENGTH } from "#/features/event-requests/schema";

const valid = { eventId: 1, item: "Projector", quantity: 2, notes: "HDMI" };

describe("EquipmentLineInput", () => {
  test("accepts a valid line and trims item", () => {
    const r = EquipmentLineInput.safeParse({ ...valid, item: "  Projector  " });
    expect(r.success).toBe(true);
    expect(r.data?.item).toBe("Projector");
  });

  test("notes and id are optional", () => {
    expect(EquipmentLineInput.safeParse({ eventId: 1, item: "Mic", quantity: 1 }).success).toBe(
      true
    );
  });

  test.each(["", "   "])("rejects blank item %j", item => {
    expect(EquipmentLineInput.safeParse({ ...valid, item }).success).toBe(false);
  });

  test("item length boundary", () => {
    const ok = "a".repeat(EQUIPMENT_TYPE_MAX_LENGTH);
    expect(EquipmentLineInput.safeParse({ ...valid, item: ok }).success).toBe(true);
    expect(EquipmentLineInput.safeParse({ ...valid, item: ok + "a" }).success).toBe(false);
  });

  // AC3
  test.each([0, -1, 1.5, Number.NaN, "3", null, undefined, Infinity])(
    "rejects quantity %p",
    quantity => {
      expect(EquipmentLineInput.safeParse({ ...valid, quantity }).success).toBe(false);
    }
  );

  test("quantity upper bound is the int4 max", () => {
    expect(EquipmentLineInput.safeParse({ ...valid, quantity: 2_147_483_647 }).success).toBe(true);
    expect(EquipmentLineInput.safeParse({ ...valid, quantity: 2_147_483_648 }).success).toBe(false);
  });

  test("notes length boundary", () => {
    expect(
      EquipmentLineInput.safeParse({
        ...valid,
        notes: "n".repeat(EQUIPMENT_NOTES_MAX),
      }).success
    ).toBe(true);
    expect(
      EquipmentLineInput.safeParse({
        ...valid,
        notes: "n".repeat(EQUIPMENT_NOTES_MAX + 1),
      }).success
    ).toBe(false);
  });

  test.each([0, -3, 1.5, "1"])("rejects eventId %p", eventId => {
    expect(EquipmentLineInput.safeParse({ ...valid, eventId }).success).toBe(false);
  });

  test("id length boundary", () => {
    expect(EquipmentLineInput.safeParse({ ...valid, id: "x".repeat(64) }).success).toBe(true);
    expect(EquipmentLineInput.safeParse({ ...valid, id: "x".repeat(65) }).success).toBe(false);
    expect(EquipmentLineInput.safeParse({ ...valid, id: "" }).success).toBe(false);
  });
});

describe("parse* helpers throw Error with the first issue message", () => {
  test("save", () => {
    expect(() => parseEquipmentLineInput({ ...valid, quantity: 0 })).toThrow(Error);
    expect(() => parseEquipmentLineInput({ ...valid, item: "" })).toThrow(
      "Enter an equipment type"
    );
  });
  test("remove", () => {
    expect(() => parseRemoveEquipmentLineInput({ eventId: 1 })).toThrow("Choose an equipment line");
  });
  test("submit", () => {
    expect(() => parseSubmitEquipmentInput({})).toThrow("Choose an event");
    expect(parseSubmitEquipmentInput({ eventId: 5 })).toEqual({ eventId: 5 });
  });
});

const form = (quantity: string, extra: Partial<{ item: string; notes: string }> = {}) =>
  EquipmentLineFormInput.safeParse({
    item: "Projector",
    quantity,
    notes: "",
    ...extra,
  });
describe("EquipmentLineFormInput (string leaves)", () => {
  // AC3 at the form level
  test.each(["", "0", "-1", "1.5", "1e3", " 3", "3 ", "abc", "+3", "12345678901234567890"])(
    "rejects quantity %j",
    q => {
      expect(form(q).success).toBe(false);
    }
  );

  test("converts numeric strings", () => {
    expect(form("3").data?.quantity).toBe(3);
    expect(form("007").data?.quantity).toBe(7);
  });

  test("empty notes become undefined; non-empty are kept", () => {
    expect(form("1").data?.notes).toBeUndefined();
    expect(form("1", { notes: "Needs HDMI" }).data?.notes).toBe("Needs HDMI");
  });

  test("blank item errors on the item path", () => {
    const r = form("1", { item: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["item"]);
  });

  test("bad quantity errors on the quantity path", () => {
    const r = form("0");
    expect(r.error?.issues[0].path).toEqual(["quantity"]);
  });
});

describe("isEquipmentEditableStatus", () => {
  test.each(["approved", "planning"])("editable on %s", status => {
    expect(isEquipmentEditableStatus(status)).toBe(true);
  });

  test.each(["submitted", "under_review", "rejected", "confirmed", "draft", ""])(
    "not editable on %s",
    status => {
      expect(isEquipmentEditableStatus(status)).toBe(false);
    }
  );
});
