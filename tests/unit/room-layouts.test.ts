import { describe, expect, it } from "vitest";

import { evaluateVenueSuitability, requirementFailures } from "#/features/venues/records.server";
import {
  DEFAULT_OPERATING_HOURS,
  INITIAL_ROOM_LAYOUTS,
  LAYOUT_LABELS,
  LAYOUT_MESSAGE,
  ROOM_LAYOUT_LABEL_REQUIRED_MESSAGE,
  RoomLayoutInput,
  VENUE_LAYOUTS,
  assertKnownLayoutText,
  createVenueSearchFormInput,
  layoutLabel,
  layoutLabelForKey,
  parseLayouts,
  parseRoomLayoutInput,
  parseRoomLayoutKey,
} from "#/features/venues/schema";
import type { RoomLayout } from "#/features/venues/schema";
import { createVenueRequestInput } from "#/features/venue-requests/schema";

const CABARET: readonly RoomLayout[] = [
  ...INITIAL_ROOM_LAYOUTS,
  { key: "cabaret", label: "Cabaret" },
];

const RENAMED: readonly RoomLayout[] = INITIAL_ROOM_LAYOUTS.map(layout =>
  layout.key === "theatre" ? { ...layout, label: "Theater Hall" } : layout
);

function searchValues(layout: string) {
  return {
    eventId: "",
    date: "",
    endDate: "",
    startTime: "",
    endTime: "",
    expectedAttendance: "",
    capacity: "",
    location: "",
    accessibility: "",
    layout,
    facilities: "",
  };
}

describe("PTR-161 room layout list", () => {
  it("ships the six current layouts under their current keys", () => {
    expect(INITIAL_ROOM_LAYOUTS).toHaveLength(6);
    expect(INITIAL_ROOM_LAYOUTS.map(layout => layout.key)).toEqual([...VENUE_LAYOUTS]);
    for (const layout of INITIAL_ROOM_LAYOUTS) {
      expect(layout.label).toBe(LAYOUT_LABELS[layout.key]);
    }
  });

  it("matches a label as a whole phrase, case-insensitive", () => {
    expect(parseLayouts("Theatre seating")).toEqual(["theatre"]);
    expect(parseLayouts("THEATRE")).toEqual(["theatre"]);
    expect(parseLayouts("another layout")).toEqual([]);
    expect(parseLayouts("classroom, theatre")).toEqual(["theatre", "classroom"]);
    expect(parseLayouts("We need cabaret tables", CABARET)).toEqual(["cabaret"]);
    expect(parseLayouts("We need CABARET tables", CABARET)).toEqual(["cabaret"]);
    expect(layoutLabel("We need cabaret tables", CABARET)).toBe("Cabaret");
  });

  it("matches a renamed label and keeps the stable key", () => {
    expect(parseLayouts("We need theater hall seating", RENAMED)).toEqual(["theatre"]);
    expect(parseLayouts("Theatre seating", RENAMED)).toEqual([]);
    expect(layoutLabel("We need theater hall seating", RENAMED)).toBe("Theater Hall");
    expect(layoutLabelForKey("theatre", RENAMED)).toBe("Theater Hall");
    expect(layoutLabelForKey("missing", RENAMED)).toBe("missing");
  });

  it("matches a multi-word label with any separator", () => {
    const layouts = [{ key: "u-shape", label: "U-Shape" }];
    expect(parseLayouts("U-shape seating", layouts)).toEqual(["u-shape"]);
    expect(parseLayouts("U shape seating", layouts)).toEqual(["u-shape"]);
    expect(parseLayouts("Usual seating", layouts)).toEqual([]);
  });

  it("matches the multi-word label U-shape as a whole phrase (AC5)", () => {
    const layouts = [...INITIAL_ROOM_LAYOUTS, { key: "u-shape", label: "U-shape" }];
    expect(parseLayouts("We prefer U-shape, theatre style", layouts)).toEqual([
      "theatre",
      "u-shape",
    ]);
    expect(parseLayouts("WE PREFER U-SHAPE", layouts)).toEqual(["u-shape"]);
    expect(parseLayouts("Our usual shape", layouts)).toEqual([]);
  });

  it("checks only the key shape, so a new key passes validation", () => {
    expect(parseRoomLayoutInput({ key: "cabaret", label: "Cabaret" })).toEqual({
      key: "cabaret",
      label: "Cabaret",
    });
    expect(parseRoomLayoutInput({ key: "Cabaret", label: "Cabaret" }).key).toBe("cabaret");
    expect(() => parseRoomLayoutInput({ key: "a b", label: "A B" })).toThrow(LAYOUT_MESSAGE);
    expect(() => parseRoomLayoutInput({ key: "", label: "Cabaret" })).toThrow(LAYOUT_MESSAGE);
    expect(() => parseRoomLayoutInput({ key: "cabaret", label: "  " })).toThrow(
      ROOM_LAYOUT_LABEL_REQUIRED_MESSAGE
    );
    expect(() => parseRoomLayoutKey({ key: "no such key!" })).toThrow(LAYOUT_MESSAGE);
    expect(parseRoomLayoutKey({ key: "cabaret" })).toEqual({ key: "cabaret" });
    expect(RoomLayoutInput.safeParse({ key: "cabaret" }).success).toBe(false);
  });

  it("refuses free text that names no maintained layout", () => {
    expect(() => assertKnownLayoutText("stadium", INITIAL_ROOM_LAYOUTS)).toThrow(LAYOUT_MESSAGE);
    expect(assertKnownLayoutText("cabaret style", CABARET)).toBeUndefined();
    expect(() => assertKnownLayoutText("cabaret style", INITIAL_ROOM_LAYOUTS)).toThrow(
      LAYOUT_MESSAGE
    );
    expect(assertKnownLayoutText("", CABARET)).toBeUndefined();
    expect(assertKnownLayoutText(undefined, CABARET)).toBeUndefined();
  });

  it("validates the search form against the loader list", () => {
    const input = createVenueSearchFormInput(CABARET);
    expect(input.parse(searchValues("cabaret style"))).toMatchObject({
      layout: "cabaret style",
    });
    expect(input.safeParse(searchValues("stadium")).success).toBe(false);
    expect(input.safeParse(searchValues("stadium")).error?.issues[0].message).toBe(LAYOUT_MESSAGE);
  });

  it("validates a request layout against the loader list", () => {
    const valid = {
      eventId: 1,
      venueId: 2,
      date: "2027-05-01",
      startTime: "10:00",
      endTime: "12:00",
    };
    expect(
      createVenueRequestInput(CABARET).parse({ ...valid, layout: "cabaret style" })
    ).toMatchObject({ layout: "cabaret style" });
    expect(
      createVenueRequestInput(INITIAL_ROOM_LAYOUTS).safeParse({
        ...valid,
        layout: "cabaret style",
      }).success
    ).toBe(false);
  });

  it("runs suitability against the maintained list", () => {
    const venue = {
      maxCapacity: 100,
      facilities: [],
      accessibilityFeatures: [],
      supportedLayouts: ["cabaret"],
    };
    expect(requirementFailures(venue, { layout: "cabaret style" }, CABARET)).toEqual([]);
    expect(requirementFailures(venue, { layout: "cabaret style" }, INITIAL_ROOM_LAYOUTS)).toEqual([
      { criterion: "layout", message: "Does not offer cabaret style" },
    ]);
  });

  it("shows a renamed key under its new label in suitability", () => {
    const venue = {
      location: "East Wing",
      maxCapacity: 100,
      facilities: [],
      accessibilityFeatures: [],
      supportedLayouts: ["theatre"],
      operatingHours: DEFAULT_OPERATING_HOURS,
    };
    expect(
      evaluateVenueSuitability(venue, { layout: "Theater hall seating" }, [], [], [], RENAMED)
        .suitable
    ).toBe(true);
    expect(requirementFailures(venue, { layout: "Theater hall seating" }, RENAMED)).toEqual([]);
    expect(
      requirementFailures(
        { ...venue, supportedLayouts: ["boardroom"] },
        { layout: "Theater hall seating" },
        RENAMED
      )
    ).toEqual([{ criterion: "layout", message: "Does not offer Theater Hall" }]);
  });
});
