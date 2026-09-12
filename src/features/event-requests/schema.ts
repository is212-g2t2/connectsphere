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
export const EQUIPMENT_QUANTITY_MESSAGE = "Equipment quantity must be a positive whole number";

export const EVENT_NAME_MAX_LENGTH = 200;
export const PURPOSE_MAX_LENGTH = 2000;
export const EVENT_NAME_MESSAGE = `Event name must be ${EVENT_NAME_MAX_LENGTH} characters or fewer`;
export const PURPOSE_MESSAGE = `Purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer`;

/** Postgres `integer` is int4: anything larger fails at the driver, so the schema stops it first. */
const MAX_INTEGER = 2_147_483_647;

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

/**
 * One proposed window, both sides optional while the request is still a draft: an organiser may
 * know only the start, or be mid-way through editing a line. The order is checked only once both
 * sides are present, which mirrors how PTR-9's single range behaved.
 */
const ProposedDate = z
  .object({
    start: LocalDateTime.optional(),
    end: LocalDateTime.optional(),
  })
  .refine(
    value =>
      value.start === undefined ||
      value.end === undefined ||
      asInstant(value.end) > asInstant(value.start),
    { message: END_BEFORE_START_MESSAGE, path: ["end"] }
  );

const PositiveWholeNumber = (message: string) =>
  z.number({ error: message }).int(message).positive(message).max(MAX_INTEGER, message);

/**
 * All-or-nothing would reject a line the organiser is still typing, so each side is optional on
 * its own — the same draft leniency the proposed dates get. PTR-13 is what refuses a submitted
 * request whose equipment lines are incomplete.
 */
const EquipmentRequirement = z.object({
  type: z.string().default(""),
  quantity: PositiveWholeNumber(EQUIPMENT_QUANTITY_MESSAGE).optional(),
});

export const EventRequestDraftInput = z.object({
  /**
   * Absent while a draft is being created; carried once it exists so a second save updates
   * the row the organiser is already editing rather than opening another draft beside it.
   */
  id: z.number().int().positive().optional(),
  eventName: z.string().max(EVENT_NAME_MAX_LENGTH, EVENT_NAME_MESSAGE).default(""),
  purpose: z.string().max(PURPOSE_MAX_LENGTH, PURPOSE_MESSAGE).default(""),
  proposedDates: z.array(ProposedDate).default([]),
  expectedAttendance: PositiveWholeNumber(ATTENDANCE_MESSAGE).optional(),
  description: z.string().default(""),
  eventType: z.string().default(""),
  venueRequirements: z.string().default(""),
  roomLayoutPreference: z.string().default(""),
  accessibilityRequirements: z.string().default(""),
  equipmentRequirements: z.array(EquipmentRequirement).default([]),
  specialArrangements: z.string().default(""),
});

export type EventRequestDraftValues = z.infer<typeof EventRequestDraftInput>;

function parseWholeNumber(value: string) {
  // Validate the entered text before Number can round a fractional value to an integer.
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * The shape the form holds: every leaf is a string, because that is what its inputs give back.
 * Parsing it drops the rows the organiser left blank and converts the strings into the wire
 * shape, then pipes through `EventRequestDraftInput` so both sides share one set of rules. It is
 * passed to TanStack Form as a standard-schema validator, which reads the issue paths as field
 * names and attaches each message to its input.
 */
const EventRequestDraftFormShape = z.object({
  eventName: z.string(),
  purpose: z.string(),
  proposedDates: z.array(z.object({ key: z.string(), start: z.string(), end: z.string() })),
  expectedAttendance: z.string(),
  description: z.string(),
  eventType: z.string(),
  venueRequirements: z.string(),
  roomLayoutPreference: z.string(),
  accessibilityRequirements: z.string(),
  equipmentRequirements: z.array(
    z.object({ key: z.string(), type: z.string(), quantity: z.string() })
  ),
  specialArrangements: z.string(),
});

export type EventRequestDraftFormValues = z.infer<typeof EventRequestDraftFormShape>;

export const EventRequestDraftFormInput = EventRequestDraftFormShape.transform(
  (values): z.input<typeof EventRequestDraftInput> => ({
    eventName: values.eventName,
    purpose: values.purpose,
    proposedDates: values.proposedDates
      .filter(date => date.start !== "" || date.end !== "")
      .map(date => {
        const line: { start?: string; end?: string } = {};
        if (date.start) line.start = date.start;
        if (date.end) line.end = date.end;
        return line;
      }),
    ...(values.expectedAttendance === ""
      ? {}
      : { expectedAttendance: parseWholeNumber(values.expectedAttendance) }),
    description: values.description,
    eventType: values.eventType,
    venueRequirements: values.venueRequirements,
    roomLayoutPreference: values.roomLayoutPreference,
    accessibilityRequirements: values.accessibilityRequirements,
    equipmentRequirements: values.equipmentRequirements
      .filter(line => line.type !== "" || line.quantity !== "")
      .map(line => {
        const requirement: { type: string; quantity?: number } = { type: line.type };
        if (line.quantity !== "") requirement.quantity = parseWholeNumber(line.quantity);
        return requirement;
      }),
    specialArrangements: values.specialArrangements,
  })
).pipe(EventRequestDraftInput);

export function parseDraftInput(data: unknown): EventRequestDraftValues {
  const parsed = EventRequestDraftInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * The PTR-10 mandatory fields, checked against a saved request. Drafting stays lenient — PTR-9
 * lets absent fields save — so only a submission path calls this: PTR-13 refuses the request when
 * the returned list is non-empty. `null` is accepted for attendance because that is how an absent
 * value comes back from the database.
 */
export function missingRequiredFields(values: {
  eventName: string;
  purpose: string;
  proposedDates: { start?: string; end?: string }[];
  expectedAttendance?: number | null;
}): string[] {
  const missing: string[] = [];

  if (values.eventName.trim() === "") missing.push("Event name");
  if (values.purpose.trim() === "") missing.push("Purpose");
  if (
    values.proposedDates.length === 0 ||
    values.proposedDates.some(date => date.start === undefined || date.end === undefined)
  ) {
    missing.push("Proposed dates and times");
  }
  if (values.expectedAttendance === undefined || values.expectedAttendance === null) {
    missing.push("Expected attendance");
  }

  return missing;
}
