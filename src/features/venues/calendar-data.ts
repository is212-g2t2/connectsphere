import { z } from "zod";
import {
  compareTimestamps,
  isCivilDate,
  isFloatingTimestamp,
} from "#/features/venues/calendar-time";

const SelectionSchema = z
  .object({
    venueId: z.string({ error: "Select a venue" }).trim().min(1, "Select a venue"),
    startDate: z.iso
      .date({ error: "Enter a valid start date" })
      .refine(isCivilDate, "Enter a valid start date"),
    endDate: z.iso
      .date({ error: "Enter a valid end date" })
      .refine(isCivilDate, "Enter a valid end date"),
  })
  .refine(value => value.endDate >= value.startDate, {
    path: ["endDate"],
    message: "End date must be on or after start date",
  })
  .refine(
    value => {
      const start = Date.parse(`${value.startDate}T00:00:00Z`);
      const end = Date.parse(`${value.endDate}T00:00:00Z`);
      return (
        Number.isFinite(start) && Number.isFinite(end) && (end - start) / 86_400_000 + 1 <= 366
      );
    },
    {
      path: ["endDate"],
      message: "Date range must be 366 days or fewer",
    }
  );

/** Inclusive civil dates for the venue-local availability calendar. */
export type CalendarSelection = z.infer<typeof SelectionSchema>;
export interface CalendarVenue {
  id: string;
  name: string;
}
export interface CalendarPeriod {
  startsAt: string;
  endsAt: string;
}
export interface CalendarOccupiedPeriod extends CalendarPeriod {
  id: string;
  state: "blocked";
  visibleStart: string;
  visibleEnd: string;
}
export interface CalendarSchedule {
  venue: CalendarVenue;
  startDate: string;
  endDate: string;
  /** Period timestamps are floating venue-local wall-clock values. */
  timeZone: null;
  available: CalendarPeriod[];
  occupied: CalendarOccupiedPeriod[];
}

export function parseCalendarSelection(input: unknown): CalendarSelection {
  const parsed = SelectionSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

const VenueSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const ListedVenueSchema = z
  .object({ id: z.number().int().positive(), name: z.string().min(1) })
  .transform(venue => ({ id: String(venue.id), name: venue.name }));
const TimestampSchema = z.string().refine(isFloatingTimestamp, "Invalid calendar timestamp");
const PeriodSchema = z
  .object({ startsAt: TimestampSchema, endsAt: TimestampSchema })
  .refine(value => compareTimestamps(value.endsAt, value.startsAt) > 0);
const ScheduleSchema = z
  .object({
    venue: VenueSchema,
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timeZone: z.null(),
    available: z.array(PeriodSchema),
    occupied: z.array(
      z
        .object({
          id: z.string(),
          state: z.literal("blocked"),
          startsAt: TimestampSchema,
          endsAt: TimestampSchema,
          visibleStart: TimestampSchema,
          visibleEnd: TimestampSchema,
        })
        .refine(
          value =>
            compareTimestamps(value.startsAt, value.visibleStart) <= 0 &&
            compareTimestamps(value.visibleStart, value.visibleEnd) < 0 &&
            compareTimestamps(value.visibleEnd, value.endsAt) <= 0
        )
    ),
  })
  .strict();

export class CalendarRequestError extends Error {
  constructor(readonly status: number) {
    super("Venue availability could not be loaded");
  }
}

function throwForResponse(result: unknown): asserts result is Exclude<unknown, Response> {
  if (result instanceof Response) throw new CalendarRequestError(result.status);
}

/** Live server-function boundary; it never falls back to fixtures or invented empty data. */
export async function listCalendarVenues(): Promise<CalendarVenue[]> {
  const { listVenues } = await import("#/features/venues/server-fns");
  const result: unknown = await listVenues();
  throwForResponse(result);
  const parsed = z.array(ListedVenueSchema).safeParse(result);
  if (!parsed.success) throw new Error("Invalid venue response");
  return parsed.data;
}

export async function readCalendar(selection: CalendarSelection): Promise<CalendarSchedule> {
  const { getVenueAvailability } = await import("#/features/venues/server-fns");
  const validSelection = parseCalendarSelection(selection);
  const result: unknown = await getVenueAvailability({ data: validSelection });
  throwForResponse(result);
  const parsed = ScheduleSchema.safeParse(result);
  if (
    !parsed.success ||
    parsed.data.venue.id !== validSelection.venueId ||
    parsed.data.startDate !== validSelection.startDate ||
    parsed.data.endDate !== validSelection.endDate
  ) {
    throw new Error("Invalid availability response");
  }
  return parsed.data;
}
