import { WEEKDAYS } from "#/features/venues/schema";
import type { OperatingHours } from "#/features/venues/schema";

/**
 * Venue availability is measured in floating venue-local wall-clock time, never a `Date`.
 *
 * Postgres stores the recorded unavailability as `timestamp without time zone` with Drizzle's
 * `mode: "string"` (see `venueUnavailability` in `src/db/schema.ts`) and the operating hours are
 * `HH:MM` strings (see `venues/schema.ts`). A floating timestamp is therefore
 * `YYYY-MM-DDTHH:MM:SS[.fff]`, and fixed-width values in that shape compare as plain strings:
 * chronological order without a timezone ever entering the comparison, which is the same
 * reasoning `event-requests/format.ts` and the operating-hours schema already follow.
 */

const FLOATING_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCivilDate(value: string) {
  const match = CIVIL_DATE.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** The calendar day after `value`, or throws when it is not a civil date. */
export function nextCivilDate(value: string) {
  const date = parseCivilDate(value);
  if (!date) throw new Error("Availability contains an invalid date");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Postgres hands back `"2026-10-05 10:00:00"`; the calendar speaks the `T` spelling. */
export function normalizeDatabaseTimestamp(value: string) {
  const normalized = value.replace(" ", "T");
  if (!isFloatingTimestamp(normalized))
    throw new Error("Availability contains an invalid timestamp");
  return normalized;
}

/** Bad source data must not read as an available venue, so this throws rather than guesses. */
export function isFloatingTimestamp(value: string) {
  return FLOATING_TIMESTAMP.test(value) && parseCivilDate(value.slice(0, 10)) !== null;
}

export function compareTimestamps(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The civil day a floating timestamp falls on: `"2026-10-05"` for `"2026-10-05T23:00:00"`. */
export function timestampDay(value: string) {
  return value.slice(0, 10);
}

/** The `HH:MM:SS[.fff]` clock reading of a floating timestamp. */
export function timestampTime(value: string) {
  return value.slice(11);
}

/**
 * The last civil day a period covers. A period ending exactly at midnight belongs to the day
 * before, or every booking would leak one extra day onto the calendar.
 */
export function timestampEndDay(value: string) {
  return timestampTime(value).startsWith("00:00:00")
    ? previousCivilDate(timestampDay(value))
    : timestampDay(value);
}

function previousCivilDate(value: string) {
  const date = parseCivilDate(value);
  if (!date) throw new Error("Availability contains an invalid date");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The venue's opening periods across the inclusive civil-date range, one per open weekday.
 * A closed day contributes nothing; the venue is then unavailable rather than open all day.
 */
export function openingPeriods(
  startDate: string,
  endDate: string,
  operatingHours: OperatingHours
): AvailabilityPeriod[] {
  const periods: AvailabilityPeriod[] = [];
  for (let date = startDate; date <= endDate; date = nextCivilDate(date)) {
    const weekday = WEEKDAYS[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
    const hours = operatingHours[weekday];
    if (hours) {
      periods.push({ startsAt: `${date}T${hours.opens}:00`, endsAt: `${date}T${hours.closes}:00` });
    }
  }
  return periods;
}

export interface AvailabilityPeriod {
  /** Floating venue-local timestamps, as described above. */
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityRecord extends AvailabilityPeriod {
  id: string;
  label: string;
}

export interface OccupiedPeriod extends AvailabilityPeriod {
  id: string;
  state: "confirmed" | "blocked";
  label: string;
  /** The part of the record that lies inside the requested range. */
  visibleStart: string;
  visibleEnd: string;
}

export interface AvailabilityProjection {
  occupied: OccupiedPeriod[];
  available: AvailabilityPeriod[];
}

/**
 * The occupancy and free gaps for one venue across a range. Intervals are positive-duration
 * `[start, end)` extents, not permission to create adjacent bookings — buffers belong to booking
 * policy, which no story owns yet.
 *
 * `bookings` is the seam an approved booking arrives through: PTR-31/PTR-33 own booking
 * persistence, so today every caller passes an empty list and only `blocks` are live. The empty
 * list is deliberate and marked at the call site (`records.server.ts`); it is not a fallback.
 */
export function projectAvailability(
  range: AvailabilityPeriod,
  source: {
    bookings: readonly AvailabilityRecord[];
    blocks: readonly AvailabilityRecord[];
    openPeriods: readonly AvailabilityPeriod[];
  }
): AvailabilityProjection {
  if (compareTimestamps(range.endsAt, range.startsAt) <= 0) {
    throw new Error("Availability contains an invalid range");
  }

  function clip(period: AvailabilityPeriod): AvailabilityPeriod | null {
    if (
      !isFloatingTimestamp(period.startsAt) ||
      !isFloatingTimestamp(period.endsAt) ||
      compareTimestamps(period.endsAt, period.startsAt) <= 0
    ) {
      throw new Error("Availability contains an invalid period");
    }
    if (
      compareTimestamps(period.startsAt, range.endsAt) >= 0 ||
      compareTimestamps(period.endsAt, range.startsAt) <= 0
    )
      return null;
    return {
      startsAt:
        compareTimestamps(period.startsAt, range.startsAt) < 0 ? range.startsAt : period.startsAt,
      endsAt: compareTimestamps(period.endsAt, range.endsAt) > 0 ? range.endsAt : period.endsAt,
    };
  }

  const occupied: OccupiedPeriod[] = [];
  function addOccupied(record: AvailabilityRecord, state: OccupiedPeriod["state"]) {
    const visible = clip(record);
    if (!visible) return;
    occupied.push({
      id: record.id,
      state,
      label: record.label,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      visibleStart: visible.startsAt,
      visibleEnd: visible.endsAt,
    });
  }
  for (const booking of source.bookings) addOccupied(booking, "confirmed");
  for (const block of source.blocks) addOccupied(block, "blocked");
  occupied.sort(
    (left, right) =>
      compareTimestamps(left.visibleStart, right.visibleStart) || left.id.localeCompare(right.id)
  );

  // Union the opening periods before subtracting occupancy, so overlapping opening rules cannot
  // duplicate a free period. The original records stay separate until here.
  const openings = source.openPeriods
    .map(clip)
    .filter((period): period is AvailabilityPeriod => period !== null)
    .toSorted((left, right) => compareTimestamps(left.startsAt, right.startsAt));
  const merged: AvailabilityPeriod[] = [];
  for (const opening of openings) {
    const previous = merged.at(-1);
    if (previous && compareTimestamps(opening.startsAt, previous.endsAt) <= 0) {
      if (compareTimestamps(opening.endsAt, previous.endsAt) > 0) previous.endsAt = opening.endsAt;
    } else merged.push({ ...opening });
  }

  const available: AvailabilityPeriod[] = [];
  for (const opening of merged) {
    let cursor = opening.startsAt;
    for (const record of occupied) {
      if (compareTimestamps(record.visibleEnd, cursor) <= 0) continue;
      if (compareTimestamps(record.visibleStart, opening.endsAt) >= 0) break;
      if (compareTimestamps(record.visibleStart, cursor) > 0) {
        available.push({ startsAt: cursor, endsAt: record.visibleStart });
      }
      cursor =
        compareTimestamps(record.visibleEnd, opening.endsAt) < 0
          ? record.visibleEnd
          : opening.endsAt;
      if (compareTimestamps(cursor, opening.endsAt) >= 0) break;
    }
    if (compareTimestamps(cursor, opening.endsAt) < 0) {
      available.push({ startsAt: cursor, endsAt: opening.endsAt });
    }
  }
  return { occupied, available };
}
