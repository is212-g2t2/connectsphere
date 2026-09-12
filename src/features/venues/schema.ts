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

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * One opening range per weekday, `null` when the venue is closed that day. Times are `"HH:MM"`
 * wall-clock, no offset — the same convention as `event_requests.proposed_start`, so a calendar
 * (PTR-28) compares them to an event's proposed times without any timezone arithmetic.
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
export const TAG_MESSAGE = `Each entry must be between 1 and ${TAG_MAX_LENGTH} characters`;
export const TAGS_COUNT_MESSAGE = `List ${TAGS_MAX_COUNT} entries or fewer`;
export const LAYOUT_MESSAGE = "Choose only from the supported room layouts";
export const TIME_MESSAGE = "Enter opening and closing times as HH:MM";
export const CLOSES_BEFORE_OPENS_MESSAGE = "Closing time must be later than opening time";

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
 * bounds are checked on what will actually be stored.
 */
const TagList = z
  .array(z.string())
  .transform(values => [
    ...new Set(values.map(value => value.trim()).filter(value => value.length > 0)),
  ])
  .pipe(
    z
      .array(z.string().min(1, TAG_MESSAGE).max(TAG_MAX_LENGTH, TAG_MESSAGE))
      .max(TAGS_MAX_COUNT, TAGS_COUNT_MESSAGE)
  );

export const VenueInput = z.object({
  /** Absent when creating; carried when editing so the save updates that row (PTR-26 AC1). */
  id: z.number().int().positive().optional(),
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
  maxCapacity: z
    .number({ error: CAPACITY_MESSAGE })
    .int(CAPACITY_MESSAGE)
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
export type VenueId = { id: number };

export const VenueIdInput = z.object({ id: z.number().int().positive() });

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
    throw new Error("Choose a venue");
  }
  return parsed.data;
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
