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
export const REGISTRATION_CAPACITY_MESSAGE =
  "Registration capacity must be a positive whole number";
// As with `venues.max_capacity`: 3_000_000_000 *is* a positive whole number, so the int4 ceiling
// says so in its own words rather than repeating the criterion-4 sentence.
export const REGISTRATION_CAPACITY_TOO_LARGE_MESSAGE =
  "Registration capacity is larger than this record can store";
export const REGISTRATION_OPENS_MESSAGE = "Enter a valid registration opening date and time";
export const REGISTRATION_CLOSES_MESSAGE = "Enter a valid registration closing date and time";
export const REGISTRATION_CAPACITY_REQUIRED_MESSAGE =
  "Registration capacity is required when registration is enabled";
export const REGISTRATION_OPENS_REQUIRED_MESSAGE =
  "A registration opening date and time is required when registration is enabled";
export const REGISTRATION_CLOSES_REQUIRED_MESSAGE =
  "A registration closing date and time is required when registration is enabled";
export const REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE = "Registration must close after it opens";
/** Postgres `integer` is int4: anything larger fails at the driver, so the schema stops it first. */
const MAX_INTEGER = 2_147_483_647;

export const ATTENDANCE_MAX = MAX_INTEGER;
export const ATTENDANCE_MAX_MESSAGE = `Expected attendance must be ${ATTENDANCE_MAX} or fewer`;

export const EVENT_NAME_MAX_LENGTH = 200;
export const PURPOSE_MAX_LENGTH = 2000;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const EVENT_TYPE_MAX_LENGTH = 200;
export const VENUE_REQUIREMENTS_MAX_LENGTH = 2000;
export const ROOM_LAYOUT_PREFERENCE_MAX_LENGTH = 2000;
export const ACCESSIBILITY_REQUIREMENTS_MAX_LENGTH = 2000;
export const SPECIAL_ARRANGEMENTS_MAX_LENGTH = 2000;
export const EQUIPMENT_TYPE_MAX_LENGTH = 200;

export const EVENT_NAME_MESSAGE = `Event name must be ${EVENT_NAME_MAX_LENGTH} characters or fewer`;
export const PURPOSE_MESSAGE = `Purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer`;
export const DESCRIPTION_MESSAGE = `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`;
export const EVENT_TYPE_MESSAGE = `Event type must be ${EVENT_TYPE_MAX_LENGTH} characters or fewer`;
export const VENUE_REQUIREMENTS_MESSAGE = `Venue requirements must be ${VENUE_REQUIREMENTS_MAX_LENGTH} characters or fewer`;
export const ROOM_LAYOUT_PREFERENCE_MESSAGE = `Room-layout preference must be ${ROOM_LAYOUT_PREFERENCE_MAX_LENGTH} characters or fewer`;
export const ACCESSIBILITY_REQUIREMENTS_MESSAGE = `Accessibility requirements must be ${ACCESSIBILITY_REQUIREMENTS_MAX_LENGTH} characters or fewer`;
export const SPECIAL_ARRANGEMENTS_MESSAGE = `Special arrangements must be ${SPECIAL_ARRANGEMENTS_MAX_LENGTH} characters or fewer`;
export const EQUIPMENT_TYPE_MESSAGE = `Equipment type must be ${EQUIPMENT_TYPE_MAX_LENGTH} characters or fewer`;

const LocalDateTime = (message: string) =>
  z.iso.datetime({ local: true, error: message }).regex(LOCAL_DATE_TIME_SHAPE, message);

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
    start: LocalDateTime(INVALID_DATE_TIME_MESSAGE).optional(),
    end: LocalDateTime(INVALID_DATE_TIME_MESSAGE).optional(),
  })
  .refine(
    value =>
      value.start === undefined ||
      value.end === undefined ||
      asInstant(value.end) > asInstant(value.start),
    { message: END_BEFORE_START_MESSAGE, path: ["end"] }
  );

const PositiveWholeNumber = (message: string, tooLargeMessage = message) =>
  z.number({ error: message }).int(message).positive(message).max(MAX_INTEGER, tooLargeMessage);

/**
 * All-or-nothing would reject a line the organiser is still typing, so each side is optional on
 * its own — the same draft leniency the proposed dates get. PTR-13 is what refuses a submitted
 * request whose equipment lines are incomplete.
 */
const EquipmentRequirement = z.object({
  type: z.string().max(EQUIPMENT_TYPE_MAX_LENGTH, EQUIPMENT_TYPE_MESSAGE).default(""),
  quantity: PositiveWholeNumber(EQUIPMENT_QUANTITY_MESSAGE).optional(),
});

export const EventRequestDraftInput = z
  .object({
    /**
     * Absent while a draft is being created; carried once it exists so a second save updates
     * the row the organiser is already editing rather than opening another draft beside it.
     * `int32` for the reason `parseEventRequestId` gives.
     */
    id: z.int32().positive().optional(),
    eventName: z.string().max(EVENT_NAME_MAX_LENGTH, EVENT_NAME_MESSAGE).default(""),
    purpose: z.string().max(PURPOSE_MAX_LENGTH, PURPOSE_MESSAGE).default(""),
    proposedDates: z.array(ProposedDate).default([]),
    expectedAttendance: z
      .number({ error: ATTENDANCE_MESSAGE })
      .int(ATTENDANCE_MESSAGE)
      .positive(ATTENDANCE_MESSAGE)
      .max(ATTENDANCE_MAX, ATTENDANCE_MAX_MESSAGE)
      .optional(),
    description: z.string().max(DESCRIPTION_MAX_LENGTH, DESCRIPTION_MESSAGE).default(""),
    eventType: z.string().max(EVENT_TYPE_MAX_LENGTH, EVENT_TYPE_MESSAGE).default(""),
    venueRequirements: z
      .string()
      .max(VENUE_REQUIREMENTS_MAX_LENGTH, VENUE_REQUIREMENTS_MESSAGE)
      .default(""),
    roomLayoutPreference: z
      .string()
      .max(ROOM_LAYOUT_PREFERENCE_MAX_LENGTH, ROOM_LAYOUT_PREFERENCE_MESSAGE)
      .default(""),
    accessibilityRequirements: z
      .string()
      .max(ACCESSIBILITY_REQUIREMENTS_MAX_LENGTH, ACCESSIBILITY_REQUIREMENTS_MESSAGE)
      .default(""),
    equipmentRequirements: z.array(EquipmentRequirement).default([]),
    specialArrangements: z
      .string()
      .max(SPECIAL_ARRANGEMENTS_MAX_LENGTH, SPECIAL_ARRANGEMENTS_MESSAGE)
      .default(""),
    /**
     * PTR-11: whether attendees may register, and on what terms. Unlike every other draft field
     * these are all-or-nothing — switching registration on asserts terms — so the three below
     * are required together the moment the flag is set.
     */
    registrationEnabled: z.boolean().default(false),
    registrationCapacity: PositiveWholeNumber(
      REGISTRATION_CAPACITY_MESSAGE,
      REGISTRATION_CAPACITY_TOO_LARGE_MESSAGE
    ).optional(),
    registrationOpensAt: LocalDateTime(REGISTRATION_OPENS_MESSAGE).optional(),
    registrationClosesAt: LocalDateTime(REGISTRATION_CLOSES_MESSAGE).optional(),
  })
  .superRefine((values, ctx) => {
    if (!values.registrationEnabled) return;

    const requiredTerms = [
      ["registrationCapacity", REGISTRATION_CAPACITY_REQUIRED_MESSAGE],
      ["registrationOpensAt", REGISTRATION_OPENS_REQUIRED_MESSAGE],
      ["registrationClosesAt", REGISTRATION_CLOSES_REQUIRED_MESSAGE],
    ] as const;

    for (const [field, message] of requiredTerms) {
      if (values[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }
    if (
      values.registrationOpensAt !== undefined &&
      values.registrationClosesAt !== undefined &&
      asInstant(values.registrationClosesAt) <= asInstant(values.registrationOpensAt)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationClosesAt"],
        message: REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE,
      });
    }
  })

  /**
   * Criterion 5: a request saved with registration off keeps no active terms. The form input
   * already omits its inactive fields, so stale strings are never validated; this transform is
   * what guarantees the parsed output carries none, whatever the caller.
   */
  .transform(values =>
    values.registrationEnabled
      ? values
      : {
          ...values,
          registrationCapacity: undefined,
          registrationOpensAt: undefined,
          registrationClosesAt: undefined,
        }
  );

export const EVENT_REQUEST_DELETE_REFUSAL =
  "This request has been submitted and can no longer be deleted.";

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
  registrationEnabled: z.boolean(),
  registrationCapacity: z.string(),
  registrationOpensAt: z.string(),
  registrationClosesAt: z.string(),
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
        const requirement: { type: string; quantity?: number } = {
          type: line.type,
        };
        if (line.quantity !== "") requirement.quantity = parseWholeNumber(line.quantity);
        return requirement;
      }),
    specialArrangements: values.specialArrangements,
    registrationEnabled: values.registrationEnabled,
    // Blank terms are passed as absent, not as malformed strings, so an enabled registration is
    // told what is missing rather than that an empty field is not a date.
    ...(values.registrationEnabled
      ? {
          registrationCapacity:
            values.registrationCapacity === ""
              ? undefined
              : parseWholeNumber(values.registrationCapacity),
          registrationOpensAt:
            values.registrationOpensAt === "" ? undefined : values.registrationOpensAt,
          registrationClosesAt:
            values.registrationClosesAt === "" ? undefined : values.registrationClosesAt,
        }
      : {}),
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
 * PTR-13 picks a saved draft by id, the same way PTR-26's venue handlers do. `int32` because
 * `event_requests.id` is an int4 column: an id past that range reaches the `where` clause and
 * Postgres answers 22003 instead of "no such draft". As with `parseVenueId`, every failure says
 * the same thing.
 */
export const EVENT_REQUEST_ID_MESSAGE = "Choose an event request";
export const EventRequestIdInput = z.object(
  { id: z.int32({ error: EVENT_REQUEST_ID_MESSAGE }).positive(EVENT_REQUEST_ID_MESSAGE) },
  { error: EVENT_REQUEST_ID_MESSAGE }
);

export function parseEventRequestId(data: unknown) {
  const parsed = EventRequestIdInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * The PTR-10 fields a submission cannot go without, checked against a saved request. Drafting
 * stays lenient — PTR-9 lets absent fields save — so only a submission path calls this: PTR-13
 * refuses the request when the returned list is non-empty. Equipment is one entry rather than one
 * per line because a half-typed line is the same problem wherever it sits, and `null` is accepted
 * for attendance because that is how an absent value comes back from the database.
 */
export function missingRequiredFields(values: {
  eventName: string;
  purpose: string;
  proposedDates: { start?: string; end?: string }[];
  expectedAttendance?: number | null;
  equipmentRequirements: { type: string; quantity?: number }[];
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
  // PTR-10 criterion 2: a line that was added carries a type and a quantity together. The save
  // path keeps a half-typed line while the organiser is still writing it; submission does not.
  if (
    values.equipmentRequirements.some(
      line => line.type.trim() === "" || line.quantity === undefined
    )
  ) {
    missing.push("Equipment requirements");
  }

  return missing;
}

/** Criterion 1's refusal: the sentence names every field the submission is still missing. */
export function missingFieldsMessage(missing: string[]): string {
  return `This request is missing: ${missing.join(", ")}`;
}

/**
 * Criterion 3's direction, shown both when the server refuses a direct edit and in the
 * confirmation that replaces the form after submitting. PTR-19 and PTR-51 are the routes this
 * points at; until they exist the sentence is still the answer an organiser gets.
 */
export const SUBMITTED_EDIT_REFUSAL =
  "This request has been submitted and can no longer be edited. Reply to a clarification request or raise a change request to change it.";
export const ALREADY_SUBMITTED_MESSAGE = "This request has already been submitted.";

/**
 * PTR-14 criterion 3: every status a request can hold, in the order the flow moves through
 * them, with what each is called on screen. Client-safe on purpose — the list page renders these
 * — so it is restated here rather than read off the Postgres enum in `#/db/schema`;
 * `tests/unit/db-schema.test.ts` holds the two lists to the same values.
 */
export const EVENT_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "awaiting_organiser",
] as const;
export type EventRequestStatus = (typeof EVENT_REQUEST_STATUSES)[number];

export const EVENT_REQUEST_STATUS_LABELS: Record<EventRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  awaiting_organiser: "Awaiting organiser",
};

// ── Clarification requests (PTR-19) ─────────────────────────────────────────

export const CLARIFICATION_BODY_MAX = 2000;
export const CLARIFICATION_BODY_MESSAGE = `Clarification text must be ${CLARIFICATION_BODY_MAX} characters or fewer`;
export const CLARIFICATION_BODY_REQUIRED = "Enter what you need the Organiser to clarify";

export const ClarificationBodyInput = z.object({
  id: z.int32({ error: EVENT_REQUEST_ID_MESSAGE }).positive(EVENT_REQUEST_ID_MESSAGE),
  body: z
    .string()
    .trim()
    .min(1, CLARIFICATION_BODY_REQUIRED)
    .max(CLARIFICATION_BODY_MAX, CLARIFICATION_BODY_MESSAGE),
});
export type ClarificationBodyValues = z.infer<typeof ClarificationBodyInput>;

export function parseClarificationBody(data: unknown): ClarificationBodyValues {
  const parsed = ClarificationBodyInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
