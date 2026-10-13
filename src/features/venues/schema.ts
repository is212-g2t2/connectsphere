import { z } from "zod";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/**
 * Routes and forms import this module, so keep it free of `#/db/schema`. Table definitions may
 * import types from here.
 */

/**
 * The six room layouts a venue may support (PTR-26 criterion 2). The VBOOK-8 story defines this
 * list, and `VenueInput` rejects other values.
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
 * Keep layout labels here so the form and read-only view can use the same words. Importing them
 * from `venue-form.tsx` would also load `@tanstack/react-form` in the read-only view.
 */
/**
 * Statuses where an assigned Coordinator can search for a venue: `submitted`, `under_review`,
 * `awaiting_organiser`, `approved`, and `planning`. Exclude drafts, rejections, and later states.
 * Keep this list client-safe so the dashboard only offers a search that can return events.
 */
export const SEARCHABLE_EVENT_STATUSES: readonly EventRequestStatus[] = [
  "submitted",
  "under_review",
  "awaiting_organiser",
  "approved",
  "planning",
];

export const LAYOUT_LABELS: Record<VenueLayout, string> = {
  theatre: "Theatre",
  classroom: "Classroom",
  boardroom: "Boardroom",
  banquet: "Banquet",
  exhibition: "Exhibition",
  other: "Other",
};

/**
 * Layouts named in free text, in `VENUE_LAYOUTS` order. Match whole words: "another layout" names
 * nothing, but "Theatre seating" names theatre. A venue matches if it supports one named layout.
 */
export function parseLayouts(value: string): VenueLayout[] {
  const words = new Set(value.toLocaleLowerCase("en").split(/[^\p{L}\p{N}]+/u));
  return VENUE_LAYOUTS.filter(layout => words.has(layout));
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** The read-only view also needs the weekday labels. */
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
 * One opening range per weekday, or `null` when the venue is closed. Times use `HH:MM` wall-clock
 * values without an offset. The calendar (PTR-28) compares them with proposed event times.
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
// 3_000_000_000 is a positive whole number, so it must fail the int4 limit, not criterion 3.
// Keep the storage limit separate so each refusal describes the right problem.
export const CAPACITY_TOO_LARGE_MESSAGE = "Maximum capacity is larger than this record can store";
export const TAG_MESSAGE = `Each entry must be between 1 and ${TAG_MAX_LENGTH} characters`;
export const TAGS_COUNT_MESSAGE = `List ${TAGS_MAX_COUNT} entries or fewer`;
export const LAYOUT_MESSAGE = "Choose only from the supported room layouts";
export const TIME_MESSAGE = "Enter opening and closing times as HH:MM";
export const CLOSES_BEFORE_OPENS_MESSAGE = "Closing time must be later than opening time";
export const DUPLICATE_NAME_MESSAGE = "A venue with this name already exists";
export const VENUE_ID_MESSAGE = "Choose a venue";

/** `<input type="time">` submits 24-hour `HH:MM` values without seconds. Venue requests use this too. */
export const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;
const Time = z.string().regex(TIME_SHAPE, TIME_MESSAGE);

const OpeningRangeSchema = z
  .object({ opens: Time, closes: Time })
  .refine(range => range.closes > range.opens, {
    message: CLOSES_BEFORE_OPENS_MESSAGE,
    path: ["closes"],
  });

/**
 * Require every weekday. Use a range or `null` for a closed day. Fixed-width `HH:MM` strings
 * sort as times, so compare `closes > opens` as strings. Build no `Date` object, as with
 * event-request dates. Spell out each day. The inferred type is then `OperatingHours` with no cast.
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
 * Clean a free-text list such as facilities. Trim each entry, drop blanks, and collapse
 * duplicates, so `"Projector, projector, "` stores one entry. Check bounds after the transform,
 * so the pipe validates stored values. Skip a lower bound because the transform removes blanks.
 */
const TagList = z
  .array(z.string())
  .transform(values => [...new Set(values.map(value => value.trim()).filter(Boolean))])
  .pipe(
    z.array(z.string().max(TAG_MAX_LENGTH, TAG_MESSAGE)).max(TAGS_MAX_COUNT, TAGS_COUNT_MESSAGE)
  );

function bufferMinutes(label: string) {
  const message = `${label} must be whole minutes of zero or more`;
  return z
    .int32({
      error: issue =>
        issue.code === "too_big" ? `${label} is larger than this record can store` : message,
    })
    .nonnegative(message)
    .default(0);
}

export const VenueInput = z.object({
  /** Omit `id` when creating. Include it when editing so the save updates that row (PTR-26 AC1). */
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
  // Criterion 3: reject floats, zero, negatives, and numeric-looking strings.
  // `venues.max_capacity` is an int4 column, so use `int32`. A plain `int` passes 3_000_000_000
  // to Postgres, and Postgres returns numeric-overflow error 22003. `rethrowReadable` cannot turn
  // that driver error into words. Report `too_big` for the storage limit and criterion 3 for other
  // issues, so each refusal describes the right problem.
  maxCapacity: z
    .int32({
      error: issue => (issue.code === "too_big" ? CAPACITY_TOO_LARGE_MESSAGE : CAPACITY_MESSAGE),
    })
    .positive(CAPACITY_MESSAGE),
  setupMinutes: bufferMinutes("Setup time"),
  turnaroundMinutes: bufferMinutes("Turnaround time"),
  facilities: TagList.default([]),
  accessibilityFeatures: TagList.default([]),
  supportedLayouts: z
    .array(z.enum(VENUE_LAYOUTS, { error: LAYOUT_MESSAGE }))
    .transform(values => [...new Set(values)])
    .default([]),
  operatingHours: OperatingHoursSchema,
});

export type VenueValues = z.infer<typeof VenueInput>;

const FormTagString = z.string().superRefine((value, ctx) => {
  const tags = [
    ...new Set(
      value
        .split(",")
        .map(t => t.trim())
        .filter(Boolean)
    ),
  ];
  if (tags.length > TAGS_MAX_COUNT) {
    ctx.addIssue({ code: "custom", message: TAGS_COUNT_MESSAGE });
  }
  for (const tag of tags) {
    if (tag.length > TAG_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: TAG_MESSAGE });
      break;
    }
  }
});

export const DayFormShape = z.object({
  open: z.boolean(),
  opens: z.string(),
  closes: z.string(),
});
export type DayFormValues = z.infer<typeof DayFormShape>;

export const VenueFormShape = z.object({
  name: z.string(),
  location: z.string(),
  maxCapacity: z.string(),
  setupMinutes: z.string(),
  turnaroundMinutes: z.string(),
  facilities: FormTagString,
  accessibilityFeatures: FormTagString,
  supportedLayouts: z.array(z.enum(VENUE_LAYOUTS, { error: LAYOUT_MESSAGE })),
  operatingHours: z.record(z.enum(WEEKDAYS), DayFormShape),
});
export type VenueFormValues = z.infer<typeof VenueFormShape>;

export const VenueFormInput = VenueFormShape.transform((values): z.input<typeof VenueInput> => {
  const operatingHours: OperatingHours = {
    mon: values.operatingHours.mon.open
      ? { opens: values.operatingHours.mon.opens, closes: values.operatingHours.mon.closes }
      : null,
    tue: values.operatingHours.tue.open
      ? { opens: values.operatingHours.tue.opens, closes: values.operatingHours.tue.closes }
      : null,
    wed: values.operatingHours.wed.open
      ? { opens: values.operatingHours.wed.opens, closes: values.operatingHours.wed.closes }
      : null,
    thu: values.operatingHours.thu.open
      ? { opens: values.operatingHours.thu.opens, closes: values.operatingHours.thu.closes }
      : null,
    fri: values.operatingHours.fri.open
      ? { opens: values.operatingHours.fri.opens, closes: values.operatingHours.fri.closes }
      : null,
    sat: values.operatingHours.sat.open
      ? { opens: values.operatingHours.sat.opens, closes: values.operatingHours.sat.closes }
      : null,
    sun: values.operatingHours.sun.open
      ? { opens: values.operatingHours.sun.opens, closes: values.operatingHours.sun.closes }
      : null,
  };

  return {
    name: values.name,
    location: values.location,
    maxCapacity: Number(values.maxCapacity),
    setupMinutes: Number(values.setupMinutes),
    turnaroundMinutes: Number(values.turnaroundMinutes),
    facilities: values.facilities.split(","),
    accessibilityFeatures: values.accessibilityFeatures.split(","),
    supportedLayouts: values.supportedLayouts,
    operatingHours,
  };
}).pipe(VenueInput);

/**
 * Use the same message for every field and object validation error. A caller may send `"7"`
 * instead of `{ id: 7 }`; the shared message avoids Zod's raw object error in `parseVenueId`.
 * Use `int32` because `venues.id` is an int4 column. A larger id would cause Postgres error 22003
 * in the `where` clause instead of "no such venue".
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
 * URL filters for venue search (PTR-29). Keep strings as entered so the Coordinator can see the
 * event's free-text requirements. The suitability evaluator normalizes them before comparison.
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
    // A typo must not silently match nothing. An empty result reads as "none available".
    if (value.layout !== undefined && parseLayouts(value.layout).length === 0) {
      ctx.addIssue({ code: "custom", path: ["layout"], message: LAYOUT_MESSAGE });
    }
  });

export type VenueSearch = z.infer<typeof VenueSearchSchema>;

export const VenueSearchFormShape = z.object({
  eventId: z.string(),
  date: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  expectedAttendance: z.string(),
  capacity: z.string(),
  location: z.string(),
  accessibility: z.string(),
  layout: z.string(),
  facilities: z.string(),
});
export type VenueSearchFormValues = z.infer<typeof VenueSearchFormShape>;

export const VenueSearchFormInput = VenueSearchFormShape.transform(
  (values): z.input<typeof VenueSearchSchema> => ({
    eventId: values.eventId,
    date: values.date,
    endDate: values.endDate,
    startTime: values.startTime,
    endTime: values.endTime,
    expectedAttendance: values.expectedAttendance,
    capacity: values.capacity,
    location: values.location,
    accessibility: values.accessibility,
    layout: values.layout,
    facilities: values.facilities,
  })
).pipe(VenueSearchSchema);

/**
 * Check whether a start/end pair crosses midnight. `VenueSearchSchema` accepts `22:00` to `02:00`
 * when a later `endDate` makes the range valid. Suitability rejects it because each day needs one
 * daily window, such as `10:00` to `12:00`. The UI uses this result to explain the refusal.
 */
export function crossesMidnight(filters: Pick<VenueSearch, "startTime" | "endTime">) {
  return (
    filters.startTime !== undefined &&
    filters.endTime !== undefined &&
    filters.startTime >= filters.endTime
  );
}

/** Open a blank form for invalid hand-edited search parameters. Do not raise a route error. */
export function parseVenueSearch(input: unknown): VenueSearch {
  const parsed = VenueSearchSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

/** Parse server-function and form input. Return typed filters or the first readable refusal. */
export function parseVenueSearchRequest(input: unknown): VenueSearch {
  const parsed = VenueSearchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * A venue and an inclusive date range for the calendar (PTR-28 criterion 1). `z.iso.date()` rejects
 * dates such as `2026-02-30`. Fixed-width values compare as strings, as in `OperatingHours`.
 * Keep this separate from `VenueInput`: the calendar reads these values and never saves them.
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

export const AvailabilitySelectionFormShape = z.object({
  venueId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});
export type AvailabilitySelectionFormValues = z.infer<typeof AvailabilitySelectionFormShape>;

export const AvailabilitySelectionFormInput = AvailabilitySelectionFormShape.transform(
  (values): z.input<typeof AvailabilitySelectionSchema> => ({
    venueId: values.venueId,
    startDate: values.startDate,
    endDate: values.endDate,
  })
).pipe(AvailabilitySelectionSchema);

/**
 * Describe optional calendar search fields. The page opens before a venue is chosen, and visitors
 * can edit the URL. `validateSearch` uses this schema, so partial input opens a blank form. It
 * raises no route error.
 */
export const AvailabilitySearchSchema = AvailabilityFields.partial();
export type AvailabilitySearch = z.infer<typeof AvailabilitySearchSchema>;

export function parseAvailabilitySearch(input: unknown): AvailabilitySearch {
  const parsed = AvailabilitySearchSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

/** Validate a calendar selection for the server function. Return the selection or the first reason it fails. */
export function parseAvailabilityRequest(input: unknown): AvailabilitySelection {
  const parsed = AvailabilitySelectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/** Support the loader. Return `null` when the search spells no complete range. */
export function parseAvailabilitySelection(input: unknown): AvailabilitySelection | null {
  const parsed = AvailabilitySelectionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Start the form with a venue open Monday to Friday and closed at the weekend. */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  mon: { opens: "08:00", closes: "22:00" },
  tue: { opens: "08:00", closes: "22:00" },
  wed: { opens: "08:00", closes: "22:00" },
  thu: { opens: "08:00", closes: "22:00" },
  fri: { opens: "08:00", closes: "22:00" },
  sat: null,
  sun: null,
};
