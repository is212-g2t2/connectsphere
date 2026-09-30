import { describe, expect, test } from "vitest";

import {
  availabilityMessage,
  computeAvailableEquipmentQuantity,
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

describe("computeAvailableEquipmentQuantity (PTR-41)", () => {
  const window = { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 12:00:00" };
  const available = (
    held: number,
    unavailable: number,
    reservations: Array<{ startsAt: string; endsAt: string; quantity: number }>
  ) => computeAvailableEquipmentQuantity(held, unavailable, window, reservations).availableQuantity;

  test("touching intervals share no peak: end-before-start ordering", () => {
    const reservations = [
      { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 11:00:00", quantity: 3 },
      { startsAt: "2030-01-01 11:00:00", endsAt: "2030-01-01 12:00:00", quantity: 3 },
    ];
    expect(available(4, 0, reservations)).toBe(1);
  });

  test("a wider reservation clamps to the window", () => {
    const reservations = [
      { startsAt: "2030-01-01 08:00:00", endsAt: "2030-01-01 18:00:00", quantity: 2 },
    ];
    expect(available(4, 0, reservations)).toBe(2);
  });

  test("reservations fully outside the window are ignored", () => {
    const reservations = [
      { startsAt: "2030-01-01 08:00:00", endsAt: "2030-01-01 10:00:00", quantity: 4 },
      { startsAt: "2030-01-01 12:00:00", endsAt: "2030-01-01 14:00:00", quantity: 4 },
      { startsAt: "2030-01-01 14:00:00", endsAt: "2030-01-01 15:00:00", quantity: 4 },
    ];
    expect(available(4, 0, reservations)).toBe(4);
  });

  test("an empty list leaves the serviceable capacity whole", () => {
    expect(available(5, 1, [])).toBe(4);
  });

  test("malformed timestamps are skipped", () => {
    const reservations = [
      { startsAt: "not-a-date", endsAt: "2030-01-01 11:00:00", quantity: 4 },
      { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 11:00:00", quantity: 1 },
    ];
    expect(available(4, 0, reservations)).toBe(3);
  });

  test("non-positive quantities are skipped", () => {
    const reservations = [
      { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 11:00:00", quantity: 0 },
      { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 11:00:00", quantity: -2 },
    ];
    expect(available(4, 0, reservations)).toBe(4);
  });

  test("held below unavailable yields zero", () => {
    expect(available(1, 3, [])).toBe(0);
  });

  test("an invalid window yields zero", () => {
    const backwards = { startsAt: "2030-01-01 12:00:00", endsAt: "2030-01-01 10:00:00" };
    const instant = { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 10:00:00" };
    expect(computeAvailableEquipmentQuantity(4, 0, backwards, [])).toEqual({
      availableQuantity: 0,
      peakReserved: 0,
    });
    expect(computeAvailableEquipmentQuantity(4, 0, instant, [])).toEqual({
      availableQuantity: 0,
      peakReserved: 0,
    });
  });

  test("reports the true peak when overbooked past capacity", () => {
    const reservations = [
      { startsAt: "2030-01-01 10:00:00", endsAt: "2030-01-01 12:00:00", quantity: 7 },
    ];
    expect(computeAvailableEquipmentQuantity(4, 0, window, reservations)).toEqual({
      availableQuantity: 0,
      peakReserved: 7,
    });
  });
});
