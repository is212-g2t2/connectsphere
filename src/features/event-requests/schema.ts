import { z } from "zod";

/**
 * The shape from `<input type="datetime-local">`: no seconds or timezone offset. Zod's ISO check
 * rejects invalid dates such as 31 April and a non-leap 29 February. The pattern limits precision
 * because the ISO check also accepts seconds.
 */
const LOCAL_DATE_TIME_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const INVALID_DATE_TIME_MESSAGE = "Enter a valid proposed date and time";
export const END_BEFORE_START_MESSAGE =
  "The proposed end date and time must be later than the start";
export const ATTENDANCE_MESSAGE = "Expected attendance must be a positive whole number";
export const EQUIPMENT_QUANTITY_MESSAGE = "Equipment quantity must be a positive whole number";
export const REGISTRATION_CAPACITY_MESSAGE =
  "Registration capacity must be a positive whole number";
// 3_000_000_000 is a positive whole number, so it must fail the int4 limit, not criterion 4.
// Keep the storage limit separate so each refusal describes the right problem.
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
/** PTR-38: one event's Coordinator panel holds at most this many lines. */
export const EQUIPMENT_MAX_LINES = 100;
export const EQUIPMENT_MAX_LINES_MESSAGE = `Equipment requirements cannot exceed ${EQUIPMENT_MAX_LINES} lines`;

export const EVENT_NAME_MESSAGE = `Event name must be ${EVENT_NAME_MAX_LENGTH} characters or fewer`;
export const PURPOSE_MESSAGE = `Purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer`;
export const DESCRIPTION_MESSAGE = `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`;
export const EVENT_TYPE_MESSAGE = `Event type must be ${EVENT_TYPE_MAX_LENGTH} characters or fewer`;
export const VENUE_REQUIREMENTS_MESSAGE = `Venue requirements must be ${VENUE_REQUIREMENTS_MAX_LENGTH} characters or fewer`;
export const ROOM_LAYOUT_PREFERENCE_MESSAGE = `Room-layout preference must be ${ROOM_LAYOUT_PREFERENCE_MAX_LENGTH} characters or fewer`;
export const ACCESSIBILITY_REQUIREMENTS_MESSAGE = `Accessibility requirements must be ${ACCESSIBILITY_REQUIREMENTS_MAX_LENGTH} characters or fewer`;
export const SPECIAL_ARRANGEMENTS_MESSAGE = `Special arrangements must be ${SPECIAL_ARRANGEMENTS_MAX_LENGTH} characters or fewer`;
export const EQUIPMENT_TYPE_MESSAGE = `Equipment type must be ${EQUIPMENT_TYPE_MAX_LENGTH} characters or fewer`;

export const LocalDateTime = (message: string) =>
  z.iso.datetime({ local: true, error: message }).regex(LOCAL_DATE_TIME_SHAPE, message);

/**
 * Compare these values as instants, not strings. Lexicographic order works only while the format
 * stays fixed-width; a wider `LOCAL_DATE_TIME_SHAPE` could silently change the result. The `Z`
 * keeps the host timezone out of the comparison. Both values use the same meridian, so only the
 * wall-clock difference remains.
 */
function asInstant(value: string): number {
  return Date.parse(`${value}Z`);
}

/**
 * One proposed window. Drafts may have only a start or may be mid-edit, so both ends are optional.
 * Check the order only when both ends exist, as PTR-9 did for its single range.
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

export const PositiveWholeNumber = (message: string, tooLargeMessage = message) =>
  z.number({ error: message }).int(message).positive(message).max(MAX_INTEGER, tooLargeMessage);

/**
 * Keep both fields optional while the Organiser edits a draft. This matches proposed-date fields.
 * PTR-13 rejects submitted requests with incomplete equipment lines.
 */
const EquipmentRequirement = z.object({
  type: z.string().max(EQUIPMENT_TYPE_MAX_LENGTH, EQUIPMENT_TYPE_MESSAGE).default(""),
  quantity: PositiveWholeNumber(EQUIPMENT_QUANTITY_MESSAGE).optional(),
});

export const EventRequestDraftInput = z
  .object({
    /**
     * Omit this when creating a draft. Include it on later saves to update the same row.
     * Use `int32` for the reason `parseEventRequestId` gives.
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
    equipmentRequirements: z
      .array(EquipmentRequirement)
      .max(EQUIPMENT_MAX_LINES, EQUIPMENT_MAX_LINES_MESSAGE)
      .default([]),
    specialArrangements: z
      .string()
      .max(SPECIAL_ARRANGEMENTS_MAX_LENGTH, SPECIAL_ARRANGEMENTS_MESSAGE)
      .default(""),
    /**
     * PTR-11: Whether attendees may register and on what terms.
     * Require all three terms when registration is on. Other draft fields can be incomplete.
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
   * Criterion 5: Omit registration terms when registration is off.
   * The form already omits inactive fields. This transform also removes stale values from other callers.
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

export function parseWholeNumber(value: string) {
  // Validate the entered text before Number can round a fractional value to an integer.
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * The form stores each value as a string because that is what its inputs return.
 * Parsing drops blank rows and converts strings to the wire shape. Then validate with
 * `EventRequestDraftInput` so both sides use the same rules. TanStack Form uses this standard
 * schema to map issue paths to fields and show each message by its input.
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
    // Treat blank terms as absent, not invalid strings. Enabled registration then reports a missing term, not an invalid date.
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
 * PTR-13 selects a saved draft by id, as the PTR-26 venue handlers do.
 * Use `int32` because `event_requests.id` is an int4 column. A larger id would cause Postgres
 * error 22003 in the `where` clause instead of "no such draft". Use one message for every failure,
 * as `parseVenueId` does.
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

/** PTR-51: the Organiser must state both the target of the change and the requested new value. */
export const CHANGE_REQUEST_TEXT_MAX = 2000;
export const EventChangeRequestInput = EventRequestIdInput.extend({
  whatShouldChange: z
    .string()
    .trim()
    .min(1, "State what should change")
    .max(
      CHANGE_REQUEST_TEXT_MAX,
      `What should change must be ${CHANGE_REQUEST_TEXT_MAX} characters or fewer`
    ),
  requestedValue: z
    .string()
    .trim()
    .min(1, "Enter the requested new value")
    .max(
      CHANGE_REQUEST_TEXT_MAX,
      `Requested new value must be ${CHANGE_REQUEST_TEXT_MAX} characters or fewer`
    ),
});

export function parseEventChangeRequestInput(data: unknown) {
  const parsed = EventChangeRequestInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * Check the saved request for required PTR-10 fields. Drafts can omit fields (PTR-9), so only the
 * submission path calls this. PTR-13 refuses a request when this list is not empty. Report all
 * incomplete equipment as one item because each partial line has the same issue. Accept `null`
 * attendance because the database uses it for an absent value. PTR-155 also requires the
 * description, venue requirements, room-layout preference and accessibility requirements
 * (the Organiser may enter "None" for no needs); registration stays optional.
 */
export function missingRequiredFields(values: {
  eventName: string;
  purpose: string;
  proposedDates: { start?: string; end?: string }[];
  expectedAttendance?: number | null;
  description: string;
  venueRequirements: string;
  roomLayoutPreference: string;
  accessibilityRequirements: string;
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
  if (values.description.trim() === "") missing.push("Description");
  if (values.venueRequirements.trim() === "") missing.push("Venue requirements");
  if (values.roomLayoutPreference.trim() === "") missing.push("Room-layout preference");
  if (values.accessibilityRequirements.trim() === "") missing.push("Accessibility requirements");
  // PTR-10 criterion 2: Each added line needs both a type and a quantity. Saves allow half-written lines; submission does not.
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
 * Criterion 3's direction, shown when the server refuses a direct edit and in the confirmation
 * after submission. PTR-19 and PTR-51 provide the routes for this direction.
 */
export const SUBMITTED_EDIT_REFUSAL =
  "This request has been submitted and can no longer be edited. Reply to a clarification request or raise a change request to change it.";
export const ALREADY_SUBMITTED_MESSAGE = "This request has already been submitted.";

/**
 * PTR-14 criterion 3: List every request status in the Postgres enum's order, with its screen label.
 * `tests/unit/db-schema.test.ts` checks this order. Keep the list client-safe because the list page
 * renders it; do not import the enum from `#/db/schema`.
 */
export const EVENT_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "awaiting_organiser",
  "planning",
  "confirmed",
  "completed",
  "cancelled",
] as const;
export type EventRequestStatus = (typeof EVENT_REQUEST_STATUSES)[number];

/** PTR-51: only post-submission events that can still change accept a new change request. */
export const EVENT_CHANGE_REQUEST_CLOSED_STATUSES = [
  "draft",
  "completed",
  "cancelled",
] as const satisfies readonly EventRequestStatus[];

export function canRaiseEventChangeRequest(status: EventRequestStatus): boolean {
  return !EVENT_CHANGE_REQUEST_CLOSED_STATUSES.some(closedStatus => closedStatus === status);
}

/**
 * PTR-144: the review stages, when a request still waits for a decision. The Lead's unassigned
 * detail serves these; every other status opens the read-only event projection. One home, so the
 * sections and the page loader cannot disagree on which statuses count.
 */
export const EVENT_REQUEST_REVIEW_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_organiser",
] as const satisfies readonly EventRequestStatus[];

export function isReviewStatus(status: EventRequestStatus): boolean {
  return EVENT_REQUEST_REVIEW_STATUSES.some(reviewStatus => reviewStatus === status);
}

/**
 * PTR-145: a Lead assigns or reassigns from submission through confirmation. A draft has no
 * Coordinator, and a rejected, completed or cancelled request is closed. Keep this list in one
 * home, so the server refusal and the assignment form cannot disagree.
 */
const ASSIGNABLE_EVENT_REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_organiser",
  "approved",
  "planning",
  "confirmed",
] as const satisfies readonly EventRequestStatus[];

export function canAssignEventRequest(status: EventRequestStatus): boolean {
  return ASSIGNABLE_EVENT_REQUEST_STATUSES.some(assignable => assignable === status);
}

/**
 * PTR-149: the Lead's oversight counts an assigned event as active until it is rejected, completed
 * or cancelled. A draft is never assigned, and it is not active work. Keep the rule in one home so
 * the oversight list cannot drift from the workload it reports.
 */
const INACTIVE_EVENT_REQUEST_STATUSES = [
  "draft",
  "rejected",
  "completed",
  "cancelled",
] as const satisfies readonly EventRequestStatus[];

export function isActiveEventRequest(status: EventRequestStatus): boolean {
  return !INACTIVE_EVENT_REQUEST_STATUSES.some(inactive => inactive === status);
}

export const EVENT_CHANGE_REQUEST_CLOSED = "This event can no longer be changed.";

// ── Processing a change request (PTR-52) ────────────────────────────────────

/**
 * PTR-52 AC2: Apply a change request through the PTR-22 edit path with the request attached.
 * The alias includes every status where a request can be raised. A direct edit without a request
 * still uses `canUpdateEventInformation`'s gate.
 */
export const canApplyEventChangeRequest = canRaiseEventChangeRequest;

export const CHANGE_REQUEST_ID_MESSAGE = "Choose a change request";
export const CHANGE_REQUEST_NOT_WAITING_MESSAGE =
  "This change request is not waiting to be processed.";
export const CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE =
  "Make the requested change before applying it, or decline it with a reason.";

/** PTR-52 AC2: the Coordinator must say why they decline a change request. */
export const CHANGE_REQUEST_DECLINE_REASON_MAX = 2000;
export const EventChangeRequestDeclineInput = EventRequestIdInput.extend({
  changeRequestId: z
    .int32({ error: CHANGE_REQUEST_ID_MESSAGE })
    .positive(CHANGE_REQUEST_ID_MESSAGE),
  reason: z
    .string()
    .trim()
    .min(1, "Enter a reason for declining")
    .max(
      CHANGE_REQUEST_DECLINE_REASON_MAX,
      `The reason must be ${CHANGE_REQUEST_DECLINE_REASON_MAX} characters or fewer`
    ),
});

export function parseEventChangeRequestDeclineInput(data: unknown) {
  const parsed = EventChangeRequestDeclineInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * PTR-53 AC2: An Organiser may request cancellation while the event can change.
 * Use the same statuses as PTR-51 change requests, so one status-set change applies to both.
 * No deadline applies.
 */
export const canRequestEventCancellation = canRaiseEventChangeRequest;
export const EVENT_CANCELLATION_CLOSED = "This event can no longer be cancelled.";
export const EVENT_CANCELLATION_ALREADY_REQUESTED =
  "A cancellation request for this event is already waiting to be processed.";

/** PTR-54 AC8: the Coordinator must say why they decline a cancellation request. */
export const CANCELLATION_DECLINE_REASON_MAX = 2000;
export const EventCancellationDeclineInput = EventRequestIdInput.extend({
  reason: z
    .string()
    .trim()
    .min(1, "Enter a reason for declining")
    .max(
      CANCELLATION_DECLINE_REASON_MAX,
      `The reason must be ${CANCELLATION_DECLINE_REASON_MAX} characters or fewer`
    ),
});

export function parseEventCancellationDeclineInput(data: unknown) {
  const parsed = EventCancellationDeclineInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** PTR-21 criterion 2: the plain-language label every screen shows instead of the stored code. */
export const EVENT_REQUEST_STATUS_LABELS: Record<EventRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  awaiting_organiser: "Awaiting organiser",
  planning: "Planning",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Map each status to a `Badge` variant. Use `progress` (amber) for pending states, including a
 * request waiting on the Organiser. Use `confirmed` (harbor) for a settled good outcome and
 * `stopped` (coral) for a stopped request. Drafts use the neutral `outline` variant.
 * See docs/DESIGN.md#status-pills. This data is client-safe, so any page can import it.
 */
type EventRequestStatusVariant = "outline" | "progress" | "confirmed" | "stopped";
export const EVENT_REQUEST_STATUS_VARIANTS: Record<EventRequestStatus, EventRequestStatusVariant> =
  {
    draft: "outline",
    submitted: "progress",
    under_review: "progress",
    awaiting_organiser: "progress",
    approved: "confirmed",
    planning: "progress",
    confirmed: "confirmed",
    completed: "confirmed",
    rejected: "stopped",
    cancelled: "stopped",
  };

/**
 * Describe each status: whether a decision is final, which way it went, and the sentence shown
 * after the date. The database requires a deciding Coordinator and time from `approved` onward.
 * Keep this data in one place so pages do not repeat the status rules.
 */
export interface EventRequestStage {
  decided: boolean;
  outcome: "approved" | "rejected" | null;
  note: string;
}
export const EVENT_REQUEST_STATUS_STAGES: Record<EventRequestStatus, EventRequestStage> = {
  draft: { decided: false, outcome: null, note: "Saved as a draft and not yet submitted." },
  submitted: { decided: false, outcome: null, note: "It is with ConnectSphere for review." },
  under_review: { decided: false, outcome: null, note: "It is with ConnectSphere for review." },
  awaiting_organiser: { decided: false, outcome: null, note: "Waiting on the Organiser." },
  approved: { decided: true, outcome: "approved", note: "" },
  rejected: { decided: true, outcome: "rejected", note: "" },
  planning: { decided: true, outcome: "approved", note: "Approved and being planned." },
  confirmed: { decided: true, outcome: "approved", note: "Confirmed and going ahead." },
  completed: { decided: true, outcome: "approved", note: "The event has taken place." },
  cancelled: { decided: false, outcome: null, note: "Cancelled." },
};

// ── Clarification requests (PTR-18) ─────────────────────────────────────────

/**
 * Use one size limit for the Coordinator's question and the Organiser's reply. They share a thread,
 * so separate limits would add no useful distinction.
 */
export const CLARIFICATION_TEXT_MAX = 2000;
export const CLARIFICATION_BODY_MESSAGE = `Clarification text must be ${CLARIFICATION_TEXT_MAX} characters or fewer`;
export const CLARIFICATION_BODY_REQUIRED = "Enter what you need the Organiser to clarify";

/**
 * List the request fields a Coordinator may ask about. Most map to one `event_requests` column.
 * `attendeeRegistration` is one question that covers four columns. The server and reply form read
 * this list, so every field shown in the form is writable on the server.
 */
export const CLARIFICATION_FIELDS = [
  { key: "eventName", label: "Event name" },
  { key: "purpose", label: "Purpose" },
  { key: "proposedDates", label: "Proposed dates and times" },
  { key: "expectedAttendance", label: "Expected attendance" },
  { key: "description", label: "Description" },
  { key: "eventType", label: "Type of event" },
  { key: "venueRequirements", label: "Venue requirements" },
  { key: "roomLayoutPreference", label: "Room-layout preference" },
  { key: "accessibilityRequirements", label: "Accessibility requirements" },
  { key: "equipmentRequirements", label: "Equipment requirements" },
  { key: "specialArrangements", label: "Special arrangements" },
  { key: "attendeeRegistration", label: "Attendee registration" },
] as const;
export type ClarificationField = (typeof CLARIFICATION_FIELDS)[number]["key"];

/** The form label of a field, for the change history and the significant-change notices. */
export function clarificationFieldLabel(field: ClarificationField): string {
  return CLARIFICATION_FIELDS.find(candidate => candidate.key === field)?.label ?? field;
}

/** The four columns a reply to the one `attendeeRegistration` question may amend as a group. */
export const ATTENDEE_REGISTRATION_AMENDMENT_KEYS = [
  "registrationEnabled",
  "registrationCapacity",
  "registrationOpensAt",
  "registrationClosesAt",
] as const;

/** What a reply changed: the question's field and the before/after values a detail page shows. */
export type ClarificationAmendment = {
  field: ClarificationField;
  from: ClarificationAmendmentValue;
  to: ClarificationAmendmentValue;
};

/**
 * The JSON value of an amended field, as stored in `jsonb`. This type lets TanStack Start verify
 * that the detail payload can serialize to the client.
 */
export type ClarificationAmendmentValue =
  | string
  | number
  | boolean
  | null
  | ClarificationAmendmentValue[]
  | { [key: string]: ClarificationAmendmentValue };

/** The `event_requests` columns a reply to this field may write; empty for a field no longer known. */
export function clarificationAmendmentKeys(field: ClarificationField): readonly string[] {
  if (!CLARIFICATION_FIELDS.some(candidate => candidate.key === field)) return [];
  return field === "attendeeRegistration" ? ATTENDEE_REGISTRATION_AMENDMENT_KEYS : [field];
}

const ClarificationBodyInput = EventRequestIdInput.extend({
  permittedFields: z.array(z.enum(CLARIFICATION_FIELDS.map(field => field.key))).default([]),
  body: z
    .string()
    .trim()
    .min(1, CLARIFICATION_BODY_REQUIRED)
    .max(CLARIFICATION_TEXT_MAX, CLARIFICATION_BODY_MESSAGE),
});

export function parseClarificationBody(data: unknown) {
  const parsed = ClarificationBodyInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** The reply body alone, shared by the wire schema below and the reply form's validator. */
export const ClarificationReplyBodyInput = z
  .string()
  .trim()
  .min(1, "Enter your reply")
  .max(CLARIFICATION_TEXT_MAX, `Reply must be ${CLARIFICATION_TEXT_MAX} characters or fewer`);

const ClarificationReplyInput = z.strictObject({
  id: z.int32().positive(),
  clarificationId: z.int32().positive(),
  body: ClarificationReplyBodyInput,
  amendments: z.record(z.string(), z.unknown()).default({}),
});

export function parseClarificationReply(data: unknown) {
  const parsed = ClarificationReplyInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
/**
 * Validate the reply form. The wire schema gives `permittedFields` a default, so it accepts
 * `undefined`. The form's value always includes the array. Remove the default here so the
 * validator's input and output have the same shape.
 */
export const ClarificationFormSchema = ClarificationBodyInput.pick({ body: true }).extend({
  permittedFields: ClarificationBodyInput.shape.permittedFields.unwrap(),
});

// ── Event information updates (PTR-22) ──────────────────────────────────────

/**
 * PTR-22 AC2: The assigned Coordinator can update event information in approved, planning, and
 * confirmed stages. `planning` is between approval and confirmation (brief §5 steps 6–9).
 * Before approval, the Organiser changes the request through a clarification reply (PTR-19).
 * Rejected, completed, and cancelled events are closed.
 */
const EVENT_INFORMATION_EDITABLE_STATUSES = [
  "approved",
  "planning",
  "confirmed",
] as const satisfies readonly EventRequestStatus[];

export function canUpdateEventInformation(status: EventRequestStatus): boolean {
  return EVENT_INFORMATION_EDITABLE_STATUSES.some(editable => editable === status);
}

/** Every field an update may change and the change log names: all the request form captures. */
export const EVENT_INFORMATION_FIELDS = CLARIFICATION_FIELDS.map(field => field.key);

/** The `event_requests` columns those fields write. */
export const EVENT_INFORMATION_COLUMNS = EVENT_INFORMATION_FIELDS.flatMap(
  clarificationAmendmentKeys
);

export const EVENT_INFORMATION_AMENDMENTS_MESSAGE = "Choose the event information to update";
export const EVENT_INFORMATION_ONLY_MESSAGE = "Only event information can be updated.";

/**
 * PTR-22: An event update names the event and includes only columns the Coordinator changed.
 * Refuse other keys, as a clarification reply refuses fields outside its question.
 * The server writes the columns to the locked row and checks the result with the draft rules.
 */
const EventInformationInput = EventRequestIdInput.extend({
  amendments: z
    .record(z.string(), z.unknown(), { error: EVENT_INFORMATION_AMENDMENTS_MESSAGE })
    .refine(
      amendments => Object.keys(amendments).every(key => EVENT_INFORMATION_COLUMNS.includes(key)),
      {
        error: EVENT_INFORMATION_ONLY_MESSAGE,
      }
    ),
  /**
   * PTR-23 AC2: The Coordinator confirms they read the warning about event arrangements.
   * The server refuses a significant change without this confirmation, even on a direct call.
   * Omit it for an ordinary edit.
   */
  acknowledgeSignificant: z.boolean().optional(),
  /**
   * PTR-52 AC2: The Organiser's change request that this save applies.
   * Mark it applied in the same transaction and notify the Organiser. Omit it on a direct edit.
   */
  changeRequestId: z
    .int32({ error: CHANGE_REQUEST_ID_MESSAGE })
    .positive(CHANGE_REQUEST_ID_MESSAGE)
    .optional(),
});

export function parseEventInformationInput(data: unknown) {
  const parsed = EventInformationInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

// ── Significant changes (PTR-23) ────────────────────────────────────────────

/**
 * PTR-23 AC1: List fields with significant changes. Proposed dates set the event date, times, and
 * duration. A change to one of these five fields warns the Coordinator before save (AC2) and tells
 * staff with an arrangement after save (AC5). Changes to other fields, including accessibility
 * requirements, remain ordinary edits (AC4).
 */
export const SIGNIFICANT_FIELDS = [
  "proposedDates",
  "expectedAttendance",
  "venueRequirements",
  "equipmentRequirements",
  "roomLayoutPreference",
] as const satisfies readonly ClarificationField[];

export type SignificantField = (typeof SIGNIFICANT_FIELDS)[number];

/** The significant fields among `fields`, in the order `SIGNIFICANT_FIELDS` lists them. */
export function significantFields(fields: readonly string[]): SignificantField[] {
  return SIGNIFICANT_FIELDS.filter(field => fields.includes(field));
}

export const SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE =
  "This change is significant. Review the arrangements it affects, then save again.";
