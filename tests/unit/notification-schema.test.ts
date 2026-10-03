import { describe, expect, it } from "vitest";

import { parseMarkNotificationsReadInput } from "#/features/notifications/schema";

describe("parseMarkNotificationsReadInput (PTR-56)", () => {
  it("accepts one notification id or a mark-all cutoff", () => {
    expect(parseMarkNotificationsReadInput({ id: 3 })).toEqual({ id: 3 });
    expect(parseMarkNotificationsReadInput({ throughId: 7 })).toEqual({ throughId: 7 });
  });

  it.each([
    ["nothing", undefined],
    ["an empty object", {}],
    ["both keys at once", { id: 1, throughId: 9 }],
    ["an unknown key", { id: 1, extra: true }],
    ["a zero id", { id: 0 }],
    ["a negative cutoff", { throughId: -1 }],
    ["a fractional id", { id: 1.5 }],
    ["a string id", { id: "1" }],
    ["an id past int4", { id: 2 ** 31 }],
  ])("refuses %s with one plain message", (_, input) => {
    expect(() => parseMarkNotificationsReadInput(input)).toThrow(
      new Error("Choose a notification")
    );
  });
});
