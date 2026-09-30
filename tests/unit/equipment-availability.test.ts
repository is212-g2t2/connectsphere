import { describe, expect, test } from "vitest";

import {
  availabilityMessage,
  summariseAvailability,
} from "#/features/equipment-requests/availability";

describe("summariseAvailability (PTR-40)", () => {
  test("available is held minus reserved minus unavailable", () => {
    expect(summariseAvailability({ held: 10, reserved: 3, unavailable: 2 })).toEqual({
      held: 10,
      reserved: 3,
      unavailable: 2,
      available: 5,
      requested: 0,
      shortfall: 0,
    });
  });

  test("clamps at zero", () => {
    expect(summariseAvailability({ held: 5, reserved: 4, unavailable: 3 }).available).toBe(0);
  });

  test("states the shortfall when the request exceeds what is free", () => {
    const result = summariseAvailability({ held: 10, reserved: 4, unavailable: 0, requested: 8 });
    expect(result.shortfall).toBe(2);
    expect(availabilityMessage(result)).toBe("Short by 2: 6 available, 8 requested");
  });

  test("no shortfall when the request fits or is absent", () => {
    const fits = summariseAvailability({ held: 10, reserved: 4, unavailable: 0, requested: 6 });
    expect(fits.shortfall).toBe(0);
    expect(availabilityMessage(fits)).toBe("6 available");
    expect(summariseAvailability({ held: 1, reserved: 0, unavailable: 0 }).shortfall).toBe(0);
  });
});
