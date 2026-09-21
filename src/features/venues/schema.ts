import { z } from "zod";

/**
 * Pure data and Zod only: routes and the form import this module, so per AGENTS.md nothing
 * here may reach `#/db/schema` — the table definitions import *types* from here instead.
 */

/**
 * The room layouts a venue may declare it supports (PTR-26 criterion 2). The team's own
 * VBOOK-8 story lists these six; `VenueInput` is what refuses a value outside them.
 */
export const VENUE_LAYOUTS = [
  "theatre",
  "classroom",
  "boardroom",
  "banquet",
  "exhibition",
  "other",
] as const;
export type VenueLayout = (typeof VENUE_LAYOUTS)[number];

/**
 * What each layout is called on screen. It lives here, next to the values it labels, rather than
 * in the form: the read-only `venue-details.tsx` needs the same words, and importing them from
 * `venue-form.tsx` drags that module — and `@tanstack/react-form` with it — into the read-only
 * path's import graph.
 */
export const LAYOUT_LABELS: Record<VenueLayout, string> = {
  theatre: "Theatre",
  classroom: "Classroom",
  boardroom: "Boardroom",
  banquet: "Banquet",
  exhibition: "Exhibition",
  other: "Other",
};

/**
 * Every layout named in free text, in `VENUE_LAYOUTS` order. Matching is by whole word, so
 * "another layout" names nothing and "Theatre seating" names theatre. A requested layout matches
 * a venue when the venue supports at least one of the layouts named.
 */
export function parseLayouts(value: string): VenueLayout[] {
  const words = new Set(value.toLocaleLowerCase("en").split(/[^\p{L}\p{N}]+/u));
  return VENUE_LAYOUTS.filter(layout => words.has(layout));
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Here for the same reason as `LAYOUT_LABELS`: the read-only view spells the days out too. */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * One opening range per weekday, `null` when the venue is closed that day. Times are `"HH:MM"`
 * wall-clock, no offset, so a calendar (PTR-28) compares them to an event's proposed times without any timezone arithmetic.
 */
export interface OpeningRange {
  opens: string;
  closes: string;
}
export type OperatingHours = Record<Weekday, OpeningRange | null>;

export const VENUE_NAME_MAX_LENGTH = 120;
export const LOCATION_MAX_LENGTH = 200;
export const TAG_MAX_LENGTH = 60;
export const TAGS_MAX_COUNT = 30;

export const NAME_REQUIRED_MESSAGE = "Enter the venue's name";
export const NAME_TOO_LONG_MESSAGE = `Venue name must be ${VENUE_NAME_MAX_LENGTH} characters or fewer`;
export const LOCATION_REQUIRED_MESSAGE = "Enter the venue's location";
export const LOCATION_TOO_LONG_MESSAGE = `Location must be ${LOCATION_MAX_LENGTH} characters or fewer`;
export const CAPACITY_MESSAGE = "Maximum capacity must be a positive whole number";
// Criterion 3's sentence would be a lie about 3_000_000_000, which *is* a positive whole number.
// The int4 ceiling is a storage limit, not a criterion-3 refusal, so it says so in its own words.
export const CAPACITY_TOO_LARGE_MESSAGE = "Maximum capacity is larger than this record can store";
export const TAG_MESSAGE = `Each entry must be between 1 and ${TAG_MAX_LENGTH} characters`;
export const TAGS_COUNT_MESSAGE = `List ${TAGS_MAX_COUNT} entries or fewer`;
export const LAYOUT_MESSAGE = "Choose only from the supported room layouts";
export const TIME_MESSAGE = "Enter opening and closing times as HH:MM";
export const CLOSES_BEFORE_OPENS_MESSAGE = "Closing time must be later than opening time";
export const DUPLICATE_NAME_MESSAGE = "A venue with this name already exists";
export const VENUE_ID_MESSAGE = "Choose a venue";

/** What `<input type="time">` submits: 24-hour `HH:MM`, no seconds. */
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
const Time = z.string().regex(TIME_SHAPE, TIME_MESSAGE);

const OpeningRangeSchema = z
  .object({ opens: Time, closes: Time })
  .refine(range => range.closes > range.opens, {
    message: CLOSES_BEFORE_OPENS_MESSAGE,
    path: ["closes"],
  });

/**
 * Every weekday present, each either a range or `null` (closed). Fixed-width `HH:MM` strings
 * compare lexicographically as times, which is why `closes > opens` above is a string
 * comparison and no `Date` is ever built — the same reasoning as event-request dates.
 * Spelled out per day rather than built from `WEEKDAYS` so the inferred type is exactly
 * `OperatingHours` with no cast.
 */
const Day = OpeningRangeSchema.nullable();
export const OperatingHoursSchema = z.object({
  mon: Day,
  tue: Day,
  wed: Day,
  thu: Day,
  fri: Day,
  sat: Day,
  sun: Day,
}) satisfies z.ZodType<OperatingHours>;

/**
 * A free-text list (facilities, accessibility features): trimmed, blanks dropped, duplicates
 * collapsed, so `"Projector, projector, "` stores one entry. The pipe order matters — the
 * bounds are checked on what will actually be stored, which is also why no lower bound sits in
 * the pipe: the transform has already filtered every empty string out.
 */
const TagList = z
  .array(z.string())
  .transform(values => [...new Set(values.map(value => value.trim()).filter(Boolean))])
  .pipe(
    z.array(z.string().max(TAG_MAX_LENGTH, TAG_MESSAGE)).max(TAGS_MAX_COUNT, TAGS_COUNT_MESSAGE)
  );

export const VenueInput = z.object({
  /** Absent when creating; carried when editing so the save updates that row (PTR-26 AC1). */
  id: z.int32().positive().optional(),
  name: z
    .string()
    .trim()
    .min(1, NAME_REQUIRED_MESSAGE)
    .max(VENUE_NAME_MAX_LENGTH, NAME_TOO_LONG_MESSAGE),
  location: z
    .string()
    .trim()
    .min(1, LOCATION_REQUIRED_MESSAGE)
    .max(LOCATION_MAX_LENGTH, LOCATION_TOO_LONG_MESSAGE),
  // Criterion 3: not a float, not zero, not negative, not a string that happens to look numeric.
  // `int32`, not `int`, because `venues.max_capacity` is an int4 column: 3_000_000_000 is a
  // positive whole number, so a plain `int` would pass it to Postgres, which answers with a
  // numeric-overflow (22003) driver error that `rethrowReadable` has no way to turn into words.
  // The ceiling answers in its own words: `too_big` is the storage limit, every other issue is
  // criterion 3, whose sentence would be false about a number that is merely too large.
  maxCapacity: z
    .int32({
      error: issue => (issue.code === "too_big" ? CAPACITY_TOO_LARGE_MESSAGE : CAPACITY_MESSAGE),
    })
    .positive(CAPACITY_MESSAGE),
  facilities: TagList.default([]),
  accessibilityFeatures: TagList.default([]),
  supportedLayouts: z
    .array(z.enum(VENUE_LAYOUTS, { error: LAYOUT_MESSAGE }))
    .transform(values => [...new Set(values)])
    .default([]),
  operatingHours: OperatingHoursSchema,
});

export type VenueValues = z.infer<typeof VenueInput>;

/**
 * Every way this can fail carries the same message — on the field *and* on the object, since a
 * caller that posts `"7"` rather than `{ id: 7 }` trips the object check and would otherwise
 * have Zod's own "expected object, received string" rethrown at it by `parseVenueId`.
 * `int32` because `venues.id` is an int4 column: an id past that range reaches the `where`
 * clause and Postgres answers 22003 instead of "no such venue".
 */
export const VenueIdInput = z.object(
  { id: z.int32({ error: VENUE_ID_MESSAGE }).positive(VENUE_ID_MESSAGE) },
  { error: VENUE_ID_MESSAGE }
);
export type VenueId = z.infer<typeof VenueIdInput>;

export function parseVenueInput(data: unknown): VenueValues {
  const parsed = VenueInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export function parseVenueId(data: unknown): VenueId {
  const parsed = VenueIdInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export const VENUE_SEARCH_TIME_MESSAGE = "Choose both a start and end time";
export const VENUE_SEARCH_DATE_MESSAGE = "Choose a date when filtering by time";
export const VENUE_SEARCH_TIME_ORDER_MESSAGE = "End time must be later than start time";
export const VENUE_SEARCH_ATTENDANCE_MESSAGE =
  "Expected attendance must be a positive whole number";
export const VENUE_SEARCH_CAPACITY_MESSAGE = "Capacity must be a positive whole number";
export const VENUE_SEARCH_EVENT_MESSAGE = "Choose an event";
export const AVAILABILITY_MAX_DAYS = 366;
export const AVAILABILITY_ORDER_MESSAGE = "End date must be on or after start date";
export const AVAILABILITY_RANGE_MESSAGE = `Choose a range of ${AVAILABILITY_MAX_DAYS} days or fewer`;
const MILLISECONDS_PER_DAY = 86_400_000;
const VENUE_SEARCH_TEXT_MAX_LENGTH = 2000;

function isWithinAvailabilityRange(startDate: string, endDate: string) {
  return (
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      MILLISECONDS_PER_DAY +
      1 <=
    AVAILABILITY_MAX_DAYS
  );
}

function blankToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalPositiveInteger(message: string) {
  return z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: message })
      .pipe(z.int32({ error: message }).positive(message))
      .optional()
  );
}

const OptionalSearchText = z.preprocess(
  blankToUndefined,
  z.string().trim().max(VENUE_SEARCH_TEXT_MAX_LENGTH).optional()
);
const OptionalSearchTime = z.preprocess(blankToUndefined, Time.optional());

/**
 * URL-shaped venue filters for PTR-29. Strings are kept as entered so an event's free-text
 * requirements can be shown back to the Coordinator; the suitability evaluator normalises them
 * when it compares the venue's structured tags and layout values.
 */
export const VenueSearchSchema = z
  .object({
    eventId: optionalPositiveInteger(VENUE_SEARCH_EVENT_MESSAGE),
    date: z.preprocess(blankToUndefined, z.iso.date({ error: "Choose a date" }).optional()),
    endDate: z.preprocess(blankToUndefined, z.iso.date({ error: "Choose an end date" }).optional()),
    startTime: OptionalSearchTime,
    endTime: OptionalSearchTime,
    expectedAttendance: optionalPositiveInteger(VENUE_SEARCH_ATTENDANCE_MESSAGE),
    capacity: optionalPositiveInteger(VENUE_SEARCH_CAPACITY_MESSAGE),
    location: OptionalSearchText,
    accessibility: OptionalSearchText,
    layout: OptionalSearchText,
    facilities: OptionalSearchText,
  })
  .superRefine((value, ctx) => {
    const hasStart = value.startTime !== undefined;
    const hasEnd = value.endTime !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: VENUE_SEARCH_TIME_MESSAGE });
      return;
    }
    if ((hasStart || value.endDate !== undefined) && value.date === undefined) {
      ctx.addIssue({ code: "custom", path: ["date"], message: VENUE_SEARCH_DATE_MESSAGE });
    }
    if (value.date !== undefined && value.endDate !== undefined && value.endDate < value.date) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: AVAILABILITY_ORDER_MESSAGE,
      });
    }
    if (
      value.date !== undefined &&
      value.endDate !== undefined &&
      value.endDate >= value.date &&
      !isWithinAvailabilityRange(value.date, value.endDate)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: AVAILABILITY_RANGE_MESSAGE,
      });
    }
    if (
      value.date !== undefined &&
      value.startTime !== undefined &&
      value.endTime !== undefined &&
      `${value.endDate ?? value.date}T${value.endTime}` <= `${value.date}T${value.startTime}`
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: VENUE_SEARCH_TIME_ORDER_MESSAGE,
      });
    }
    // A typo'd layout would otherwise silently match no venue, which reads as "none available".
    if (value.layout !== undefined && parseLayouts(value.layout).length === 0) {
      ctx.addIssue({ code: "custom", path: ["layout"], message: LAYOUT_MESSAGE });
    }
  });

export type VenueSearch = z.infer<typeof VenueSearchSchema>;

/**
 * Whether a start/end pair names a window running past midnight. `VenueSearchSchema` still accepts
 * `22:00`→`02:00` when a later `endDate` makes the range order valid; suitability refuses it,
 * because "10:00 to 12:00 on each day" is the only shape a daily hosting window can take. The UI
 * imports this to explain the refusal rather than showing a silent zero.
 */
export function crossesMidnight(filters: Pick<VenueSearch, "startTime" | "endTime">) {
  return (
    filters.startTime !== undefined &&
    filters.endTime !== undefined &&
    filters.startTime >= filters.endTime
  );
}

/** Invalid hand-edited search parameters open a blank form instead of a route error. */
export function parseVenueSearch(input: unknown): VenueSearch {
  const parsed = VenueSearchSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

/** Server-function and form boundary: return typed filters or the first readable refusal. */
export function parseVenueSearchRequest(input: unknown): VenueSearch {
  const parsed = VenueSearchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * The calendar selection: a venue and an inclusive civil-date range (PTR-28 criterion 1).
 * `z.iso.date()` already rejects a date that does not exist (`2026-02-30`), and the fixed-width
 * values compare as strings, as `OperatingHours` does. Separate from `VenueInput` because this is
 * a read, not a record: nothing here is ever written back.
 */
const AvailabilityFields = z.object({
  venueId: z.coerce
    .number({ error: VENUE_ID_MESSAGE })
    .pipe(z.int32({ error: VENUE_ID_MESSAGE }).positive(VENUE_ID_MESSAGE)),
  startDate: z.iso.date({ error: "Choose a start date" }),
  endDate: z.iso.date({ error: "Choose an end date" }),
});

export const AvailabilitySelectionSchema = AvailabilityFields.refine(
  value => value.endDate >= value.startDate,
  { path: ["endDate"], message: AVAILABILITY_ORDER_MESSAGE }
).refine(value => isWithinAvailabilityRange(value.startDate, value.endDate), {
  path: ["endDate"],
  message: AVAILABILITY_RANGE_MESSAGE,
});

export type AvailabilitySelection = z.infer<typeof AvailabilitySelectionSchema>;

/**
 * The same fields as search parameters, each optional: the page opens before a venue is chosen,
 * and a visitor may hand-edit the URL. `validateSearch` uses this so a partial selection is a
 * blank form rather than a route error.
 */
export const AvailabilitySearchSchema = AvailabilityFields.partial();
export type AvailabilitySearch = z.infer<typeof AvailabilitySearchSchema>;

export function parseAvailabilitySearch(input: unknown): AvailabilitySearch {
  const parsed = AvailabilitySearchSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

/** For the server function's validator: a genuine selection or the first reason it is not one. */
export function parseAvailabilityRequest(input: unknown): AvailabilitySelection {
  const parsed = AvailabilitySelectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/** For the loader: `null` when the search does not yet spell a complete range. */
export function parseAvailabilitySelection(input: unknown): AvailabilitySelection | null {
  const parsed = AvailabilitySelectionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** A venue open Monday to Friday, closed at the weekend — the form's starting point. */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  mon: { opens: "08:00", closes: "22:00" },
  tue: { opens: "08:00", closes: "22:00" },
  wed: { opens: "08:00", closes: "22:00" },
  thu: { opens: "08:00", closes: "22:00" },
  fri: { opens: "08:00", closes: "22:00" },
  sat: null,
  sun: null,
};
