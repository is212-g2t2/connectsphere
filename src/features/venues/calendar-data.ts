import { z } from "zod";
import type { AvailabilityProjection } from "#/features/venues/availability";
import { compareFloatingTimestamps, isFloatingTimestamp } from "#/features/venues/calendar-time";

const SelectionSchema = z
  .object({
    venueId: z.string({ error: "Select a venue" }).trim().min(1, "Select a venue"),
    startDate: z.iso.date({ error: "Enter a valid start date" }),
    endDate: z.iso.date({ error: "Enter a valid end date" }),
  })
  .refine(value => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date must be on or after start date",
  });

/** Inclusive civil dates. Each schedule declares whether periods are floating or explicit instants. */
export type CalendarSelection = z.infer<typeof SelectionSchema>;
export interface CalendarVenue {
  id: string;
  name: string;
}
export interface CalendarSchedule extends AvailabilityProjection {
  venue: CalendarVenue;
  startDate: string;
  endDate: string;
  /** `null` means all period timestamps are floating venue-local wall-clock values. */
  timeZone: string | null;
}
export interface CalendarSource {
  listVenues(signal: AbortSignal): Promise<CalendarVenue[]>;
  read(selection: CalendarSelection, signal: AbortSignal): Promise<CalendarSchedule>;
}

export function parseCalendarSelection(input: unknown): CalendarSelection {
  const parsed = SelectionSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

const VenueSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const TimestampSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.string().refine(isFloatingTimestamp, "Invalid calendar timestamp"),
]);
function compareCalendarTimestamps(left: string, right: string) {
  if (isFloatingTimestamp(left) || isFloatingTimestamp(right))
    return compareFloatingTimestamps(left, right);
  return Date.parse(left) - Date.parse(right);
}
const PeriodSchema = z
  .object({ startsAt: TimestampSchema, endsAt: TimestampSchema })
  .refine(value => compareCalendarTimestamps(value.endsAt, value.startsAt) > 0);
const ScheduleSchema = z
  .object({
    venue: VenueSchema,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timeZone: z
      .string()
      .refine(value => {
        try {
          return (
            new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone.length > 0
          );
        } catch {
          return false;
        }
      })
      .nullable(),
    available: z.array(PeriodSchema),
    occupied: z.array(
      z
        .object({
          id: z.string(),
          state: z.enum(["confirmed", "blocked"]),
          startsAt: TimestampSchema,
          endsAt: TimestampSchema,
          visibleStart: TimestampSchema,
          visibleEnd: TimestampSchema,
        })
        .refine(
          value =>
            compareCalendarTimestamps(value.startsAt, value.visibleStart) <= 0 &&
            compareCalendarTimestamps(value.visibleStart, value.visibleEnd) < 0 &&
            compareCalendarTimestamps(value.visibleEnd, value.endsAt) <= 0
        )
    ),
  })
  .refine(
    schedule => {
      const expectedMode = schedule.timeZone === null ? "floating" : "instant";
      const matchesMode = (value: string) =>
        expectedMode === "floating" ? isFloatingTimestamp(value) : !isFloatingTimestamp(value);
      return (
        schedule.available.every(period => [period.startsAt, period.endsAt].every(matchesMode)) &&
        schedule.occupied.every(period =>
          [period.startsAt, period.endsAt, period.visibleStart, period.visibleEnd].every(
            matchesMode
          )
        )
      );
    },
    { message: "Invalid availability timestamp mode" }
  );

export class CalendarRequestError extends Error {
  constructor(readonly status: number) {
    super("Venue availability could not be loaded");
  }
}

async function fetchCalendarData(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new CalendarRequestError(response.status);
  return response.json();
}

/** Live HTTP boundary; it never falls back to fixtures or an invented empty schedule. */
export const calendarSource: CalendarSource = {
  async listVenues(signal) {
    const parsed = z
      .array(VenueSchema)
      .safeParse(await fetchCalendarData("/api/venue-availability/venues", signal));
    if (!parsed.success) throw new Error("Invalid venue response");
    return parsed.data;
  },
  async read(selection, signal) {
    const query = new URLSearchParams(parseCalendarSelection(selection));
    const parsed = ScheduleSchema.safeParse(
      await fetchCalendarData(`/api/venue-availability?${query}`, signal)
    );
    if (
      !parsed.success ||
      parsed.data.venue.id !== selection.venueId ||
      parsed.data.startDate !== selection.startDate ||
      parsed.data.endDate !== selection.endDate
    ) {
      throw new Error("Invalid availability response");
    }
    return parsed.data;
  },
};
