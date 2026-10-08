import { describe, expect, it } from "vitest";

import {
  NOT_REGISTERED_MESSAGE,
  PLACE_FREED_MESSAGE,
  PLACE_FREED_AT_CAPACITY_MESSAGE,
} from "#/features/events/withdrawal";

describe("Withdrawal messages (PTR-47)", () => {
  it("defines NOT_REGISTERED_MESSAGE", () => {
    expect(NOT_REGISTERED_MESSAGE).toBe("You do not hold an active registration for this event.");
  });

  it("defines PLACE_FREED_MESSAGE", () => {
    expect(PLACE_FREED_MESSAGE).toBe("Your place has been freed.");
  });

  it("defines PLACE_FREED_AT_CAPACITY_MESSAGE (AC4)", () => {
    expect(PLACE_FREED_AT_CAPACITY_MESSAGE).toBe(
      "Your place has been freed. The Organiser and Coordinator have been notified."
    );
  });
});
