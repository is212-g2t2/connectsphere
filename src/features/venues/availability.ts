import { z } from "zod";
import { compareFloatingTimestamps, isFloatingTimestamp } from "#/features/venues/calendar-time";

/** Period endpoints may be explicit instants or floating venue-local wall-clock values. */
export interface AvailabilityPeriod {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityRequest extends AvailabilityPeriod {
  venueId: string;
}

/** Read projection only: these types do not define venue or booking persistence schemas. */
export interface AvailabilityBooking extends AvailabilityPeriod {
  id: string;
  venueId: string;
  status: string;
}

export interface AvailabilityBlock extends AvailabilityPeriod {
  id: string;
  venueId: string;
}

export interface OccupiedPeriod extends AvailabilityPeriod {
  id: string;
  state: "confirmed" | "blocked";
  visibleStart: string;
  visibleEnd: string;
}

export interface AvailabilityProjection {
  occupied: OccupiedPeriod[];
  available: AvailabilityPeriod[];
}

export type AvailabilityTimeMode = "instant" | "floating";

const ExplicitTimestamp = z.iso.datetime({ offset: true });

function isTimestamp(value: string) {
  return isFloatingTimestamp(value) || ExplicitTimestamp.safeParse(value).success;
}

function timestampMode(value: string): AvailabilityTimeMode {
  return isFloatingTimestamp(value) ? "floating" : "instant";
}

function compareTimestamps(left: string, right: string, mode: AvailabilityTimeMode) {
  if (mode === "floating") {
    return compareFloatingTimestamps(left, right);
  }
  return Date.parse(left) - Date.parse(right);
}

function timestampField(error: string) {
  return z.string({ error }).refine(isTimestamp, error);
}

const RequestSchema = z
  .object({
    venueId: z.string({ error: "Select a venue" }).trim().min(1, "Select a venue"),
    startsAt: timestampField("Start time must be a valid timestamp with a timezone or local time"),
    endsAt: timestampField("End time must be a valid timestamp with a timezone or local time"),
  })
  .refine(
    input =>
      timestampMode(input.startsAt) === timestampMode(input.endsAt) &&
      compareTimestamps(input.endsAt, input.startsAt, timestampMode(input.startsAt)) > 0,
    {
      message: "End time must be after start time",
      path: ["endsAt"],
    }
  );

export function parseAvailabilityRequest(input: unknown): AvailabilityRequest {
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * Build occupancy and free gaps from an adapter's complete input, across every event.
 * Opening periods and pending treatment are required: no product timezone, operating hours
 * or pending-hold policy is assumed here. Intervals describe positive-duration [start, end)
 * extents, not permission to create adjacent bookings (buffers belong to booking policy).
 * Database adapters can use floating timestamps when persistence stores local venue time.
 * Booking persistence is deferred this sprint; booking inputs are exercised only through
 * isolated fixtures.
 */
export function projectAvailability(
  input: AvailabilityRequest,
  source: {
    bookings: readonly AvailabilityBooking[];
    blocks: readonly AvailabilityBlock[];
    openPeriods: readonly AvailabilityPeriod[];
    pendingTreatment: "hold" | "no-hold";
    timeMode?: AvailabilityTimeMode;
  }
): AvailabilityProjection {
  const range = parseAvailabilityRequest(input);
  const mode = source.timeMode ?? timestampMode(range.startsAt);
  if (timestampMode(range.startsAt) !== mode || timestampMode(range.endsAt) !== mode) {
    throw new Error("Availability contains mixed timestamp modes");
  }
  const rangeStart = range.startsAt;
  const rangeEnd = range.endsAt;
  if (compareTimestamps(rangeEnd, rangeStart, mode) <= 0) {
    throw new Error("Availability contains an invalid range");
  }

  function clip(period: AvailabilityPeriod): AvailabilityPeriod | null {
    const periodStart = compareTimestamps(period.startsAt, rangeStart, mode);
    const periodEnd = compareTimestamps(period.endsAt, rangeStart, mode);
    if (
      !isTimestamp(period.startsAt) ||
      !isTimestamp(period.endsAt) ||
      timestampMode(period.startsAt) !== mode ||
      timestampMode(period.endsAt) !== mode ||
      Number.isNaN(periodStart) ||
      Number.isNaN(periodEnd) ||
      compareTimestamps(period.endsAt, period.startsAt, mode) <= 0
    ) {
      // Bad source data must not turn into an apparently available venue.
      throw new Error("Availability contains an invalid period");
    }
    if (
      compareTimestamps(period.startsAt, rangeEnd, mode) >= 0 ||
      compareTimestamps(period.endsAt, rangeStart, mode) <= 0
    )
      return null;
    return {
      startsAt:
        compareTimestamps(period.startsAt, rangeStart, mode) < 0 ? range.startsAt : period.startsAt,
      endsAt: compareTimestamps(period.endsAt, rangeEnd, mode) > 0 ? rangeEnd : period.endsAt,
    };
  }

  const occupied: OccupiedPeriod[] = [];
  function addOccupied(record: AvailabilityBlock, state: OccupiedPeriod["state"]) {
    if (record.venueId !== range.venueId) return;
    const visible = clip(record);
    if (!visible) return;
    occupied.push({
      id: record.id,
      state,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      visibleStart: visible.startsAt,
      visibleEnd: visible.endsAt,
    });
  }
  for (const booking of source.bookings) {
    if (booking.status === "approved") addOccupied(booking, "confirmed");
    else if (booking.status === "pending" && source.pendingTreatment === "hold") {
      addOccupied(booking, "blocked");
    }
  }
  for (const block of source.blocks) addOccupied(block, "blocked");
  occupied.sort(
    (a, b) => compareTimestamps(a.visibleStart, b.visibleStart, mode) || a.id.localeCompare(b.id)
  );

  // Union opening periods before subtracting occupancy, so overlapping opening rules cannot
  // duplicate free periods. Keep the original records separate, including conflicting records.
  const openings = source.openPeriods
    .map(clip)
    .filter((period): period is AvailabilityPeriod => period !== null)
    .toSorted((a, b) => compareTimestamps(a.startsAt, b.startsAt, mode));
  const merged: AvailabilityPeriod[] = [];
  for (const opening of openings) {
    const previous = merged.at(-1);
    if (previous && compareTimestamps(opening.startsAt, previous.endsAt, mode) <= 0) {
      if (compareTimestamps(opening.endsAt, previous.endsAt, mode) > 0)
        previous.endsAt = opening.endsAt;
    } else merged.push({ ...opening });
  }

  const available: AvailabilityPeriod[] = [];
  for (const opening of merged) {
    let cursor = opening.startsAt;
    for (const record of occupied) {
      if (compareTimestamps(record.visibleEnd, cursor, mode) <= 0) continue;
      if (compareTimestamps(record.visibleStart, opening.endsAt, mode) >= 0) break;
      if (compareTimestamps(record.visibleStart, cursor, mode) > 0) {
        available.push({ startsAt: cursor, endsAt: record.visibleStart });
      }
      cursor =
        compareTimestamps(record.visibleEnd, opening.endsAt, mode) < 0
          ? record.visibleEnd
          : opening.endsAt;
      if (compareTimestamps(cursor, opening.endsAt, mode) >= 0) break;
    }
    if (compareTimestamps(cursor, opening.endsAt, mode) < 0)
      available.push({ startsAt: cursor, endsAt: opening.endsAt });
  }
  return { occupied, available };
}
