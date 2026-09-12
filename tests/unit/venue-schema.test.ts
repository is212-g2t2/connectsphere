import { describe, expect, it } from "vitest";

import {
  CAPACITY_MESSAGE,
  CLOSES_BEFORE_OPENS_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  LAYOUT_MESSAGE,
  LOCATION_REQUIRED_MESSAGE,
  NAME_REQUIRED_MESSAGE,
  NAME_TOO_LONG_MESSAGE,
  OperatingHoursSchema,
  parseVenueInput,
  TIME_MESSAGE,
  VENUE_LAYOUTS,
  VENUE_NAME_MAX_LENGTH,
  VenueInput,
} from "#/features/venues/schema";

const valid = {
  name: "Harbour Hall",
  location: "Level 1, Marina Centre",
  maxCapacity: 300,
  facilities: ["Stage", "Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre", "banquet"],
  operatingHours: DEFAULT_OPERATING_HOURS,
};

describe("VenueInput (PTR-26)", () => {
  it("accepts a complete record and keeps every criterion-2 field", () => {
    expect(parseVenueInput(valid)).toEqual(valid);
  });

  it("defaults the three lists to empty when absent", () => {
    const { facilities, accessibilityFeatures, supportedLayouts, ...required } = valid;
    expect(parseVenueInput(required)).toMatchObject({
      facilities: [],
      accessibilityFeatures: [],
      supportedLayouts: [],
    });
    expect([facilities, accessibilityFeatures, supportedLayouts]).toHaveLength(3);
  });

  it("trims, drops blanks and collapses duplicate entries in a list", () => {
    const parsed = parseVenueInput({
      ...valid,
      facilities: [" Projector ", "", "Projector", "Stage"],
    });
    expect(parsed.facilities).toEqual(["Projector", "Stage"]);
  });

  /**
   * Criterion 3, as boundary-value analysis: just below, exactly at and just above the lowest
   * valid capacity, plus each way a number can fail to be a positive whole number.
   */
  describe("maximum capacity", () => {
    it.each([1, 2, 300])("accepts %d", maxCapacity => {
      expect(parseVenueInput({ ...valid, maxCapacity }).maxCapacity).toBe(maxCapacity);
    });

    it.each<unknown>([0, -1, 1.5, "300", "", null, undefined, Number.NaN])(
      "refuses %o with the capacity message",
      maxCapacity => {
        expect(() => parseVenueInput({ ...valid, maxCapacity })).toThrow(CAPACITY_MESSAGE);
      }
    );
  });

  it("requires a name and a location", () => {
    expect(() => parseVenueInput({ ...valid, name: "   " })).toThrow(NAME_REQUIRED_MESSAGE);
    expect(() => parseVenueInput({ ...valid, location: "" })).toThrow(LOCATION_REQUIRED_MESSAGE);
  });

  it("bounds the name at exactly the maximum length", () => {
    const atLimit = "v".repeat(VENUE_NAME_MAX_LENGTH);
    expect(parseVenueInput({ ...valid, name: atLimit }).name).toBe(atLimit);
    expect(() => parseVenueInput({ ...valid, name: `${atLimit}v` })).toThrow(NAME_TOO_LONG_MESSAGE);
  });

  it("accepts every declared layout and refuses one outside the list", () => {
    expect(
      parseVenueInput({ ...valid, supportedLayouts: [...VENUE_LAYOUTS] }).supportedLayouts
    ).toEqual([...VENUE_LAYOUTS]);
    expect(() => parseVenueInput({ ...valid, supportedLayouts: ["amphitheatre"] })).toThrow(
      LAYOUT_MESSAGE
    );
  });

  it("reports the first issue only, as a plain Error", () => {
    expect(() => parseVenueInput({})).toThrow(Error);
    expect(() => parseVenueInput({})).not.toThrow(/ZodError/);
  });
});

describe("OperatingHoursSchema", () => {
  it("accepts a closed day as null and an open day as an HH:MM range", () => {
    expect(OperatingHoursSchema.safeParse(DEFAULT_OPERATING_HOURS).success).toBe(true);
  });

  it("requires all seven days", () => {
    const { sun, ...sixDays } = DEFAULT_OPERATING_HOURS;
    expect(sun).toBeNull();
    expect(OperatingHoursSchema.safeParse(sixDays).success).toBe(false);
  });

  it.each(["8:00", "24:00", "09:60", "0900", "09:00:00"])("refuses the time %s", time => {
    const result = OperatingHoursSchema.safeParse({
      ...DEFAULT_OPERATING_HOURS,
      mon: { opens: time, closes: "22:00" },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(TIME_MESSAGE);
  });

  it("refuses a closing time at or before the opening time", () => {
    for (const closes of ["09:00", "08:59"]) {
      const result = VenueInput.safeParse({
        ...valid,
        operatingHours: { ...DEFAULT_OPERATING_HOURS, mon: { opens: "09:00", closes } },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(CLOSES_BEFORE_OPENS_MESSAGE);
    }
  });
});
