import { describe, expect, it } from "vitest";

import { parseEventListInput } from "#/features/events/schema";

/**
 * `listEvents` validates its payload through this helper, and `parseEventListInput` rethrows the
 * first issue message so a raw `ZodError` never reaches the route. The cases below are the ones
 * that separate a usable `eventId` from an int4 the `where` clause would answer with 22003.
 */
describe("parseEventListInput", () => {
  it("defaults to an unfiltered list when the server function is called with no payload", () => {
    expect(parseEventListInput(undefined)).toEqual({});
  });

  it("keeps the largest id int4 holds, so the boundary is included", () => {
    expect(parseEventListInput({ eventId: 2147483647 })).toEqual({ eventId: 2147483647 });
  });

  it.each([
    ["zero", 0],
    ["a negative id", -2],
    ["a fractional id", 1.5],
    ["a numeric string", "5"],
    ["an id past int4", 2147483648],
  ])("rejects %s with the field's own message", (_label, eventId) => {
    expect(() => parseEventListInput({ eventId })).toThrow("Choose an event");
  });
});
