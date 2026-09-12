import { z } from "zod";

/**
 * The exact shape an `<input type="datetime-local">` submits: no seconds, no offset. Zod's ISO
 * check does the calendar work (rejecting 31 April and non-leap 29 February); the pattern only
 * pins the precision, which that check alone would let widen to seconds.
 */
const LOCAL_DATE_TIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const INVALID_DATE_TIME_MESSAGE = "Enter a valid proposed date and time";
export const END_BEFORE_START_MESSAGE =
  "The proposed end date and time must be later than the start";
export const ATTENDANCE_MESSAGE = "Expected attendance must be a positive whole number";

export const EVENT_NAME_MAX_LENGTH = 200;
export const PURPOSE_MAX_LENGTH = 2000;
export const EVENT_NAME_MESSAGE = `Event name must be ${EVENT_NAME_MAX_LENGTH} characters or fewer`;
export const PURPOSE_MESSAGE = `Purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer`;

const LocalDateTime = z.iso
  .datetime({ local: true, error: INVALID_DATE_TIME_MESSAGE })
  .regex(LOCAL_DATE_TIME_SHAPE, INVALID_DATE_TIME_MESSAGE);

/**
 * Compared as instants rather than as strings. Lexicographic order happens to agree while the
 * format is fixed-width, which makes a later widening of `LOCAL_DATE_TIME_SHAPE` a silent
 * behaviour change instead of a caught one. The `Z` is what keeps the comparison free of the
 * host timezone: both sides are read on the same arbitrary meridian, so only the wall-clock
 * difference survives.
 */
function asInstant(value: string): number {
  return Date.parse(`${value}Z`);
}

export const EventRequestDraftInput = z
  .object({
    /**
     * Absent while a draft is being created; carried once it exists so a second save updates
     * the row the organiser is already editing rather than opening another draft beside it.
     */
    id: z.number().int().positive().optional(),
    eventName: z.string().max(EVENT_NAME_MAX_LENGTH, EVENT_NAME_MESSAGE).default(""),
    purpose: z.string().max(PURPOSE_MAX_LENGTH, PURPOSE_MESSAGE).default(""),
    proposedStart: LocalDateTime.optional(),
    proposedEnd: LocalDateTime.optional(),
    expectedAttendance: z
      .number({ error: ATTENDANCE_MESSAGE })
      .int(ATTENDANCE_MESSAGE)
      .positive(ATTENDANCE_MESSAGE)
      .optional(),
  })
  .refine(
    value =>
      value.proposedStart === undefined ||
      value.proposedEnd === undefined ||
      asInstant(value.proposedEnd) > asInstant(value.proposedStart),
    { message: END_BEFORE_START_MESSAGE, path: ["proposedEnd"] }
  );

export type EventRequestDraftValues = z.infer<typeof EventRequestDraftInput>;

export function parseDraftInput(data: unknown): EventRequestDraftValues {
  const parsed = EventRequestDraftInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}
