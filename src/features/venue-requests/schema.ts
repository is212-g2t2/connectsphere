import { z } from "zod";

import { formatLocalDateTime } from "#/features/event-requests/format";
import { LocalDateTime } from "#/features/event-requests/schema";
import {
  LAYOUT_MESSAGE,
  TIME_SHAPE,
  VENUE_ID_MESSAGE,
  VENUE_SEARCH_ATTENDANCE_MESSAGE,
  VENUE_SEARCH_EVENT_MESSAGE,
  VENUE_SEARCH_TEXT_MAX_LENGTH,
  layoutLabel,
  parseLayouts,
} from "#/features/venues/schema";

/**
 * Routes and the form import this module. Keep it free of `#/db/schema` and other server-only dependencies.
 */

export const VENUE_REQUEST_DATE_MESSAGE = "Choose a date";
export const VENUE_REQUEST_TIME_MESSAGE = "Enter start and end times as HH:MM";
export const VENUE_REQUEST_TIME_ORDER_MESSAGE = "End time must be later than start time";
export const VENUE_REQUEST_ID_MESSAGE = "Choose a booking request";
/**
 * An exact double-submit gets this message, not a driver error: the same-event overlap check names
 * it, and the partial unique index on `(event_id, venue_id, starts_at, ends_at)` backs it.
 */
export const VENUE_REQUEST_DUPLICATE_MESSAGE =
  "This event already has a pending request for this venue and window.";
export const VENUE_REQUEST_SETTLED_MESSAGE =
  "This request has already been settled and can no longer be withdrawn.";
/** PTR-36: a request that is no longer pending cannot be approved again. */
export const VENUE_REQUEST_DECIDED_MESSAGE = "This request has already been decided.";
export const VENUE_BOOKING_NOT_APPROVED_MESSAGE =
  "Only an approved booking can be released or amended.";
/**
 * PTR-134: the fallback message when `venue_occupancy_no_overlap` refuses a ledger write that the
 * locked pre-check did not catch, such as a race with a writer that takes no venue lock. The
 * constraint covers bookings and holds together, so the message names both.
 */
export const VENUE_OCCUPANCY_CONFLICT_MESSAGE =
  "This venue is already booked or held for an overlapping period, including setup and turnaround time.";

/** PTR-34: a rejected request is final; the Coordinator raises a new one instead. */
export const VENUE_REQUEST_REJECTED_MESSAGE =
  "This request was rejected. Raise a new request instead.";
/** PTR-34 criterion 1: Venue Staff owe the Coordinator a reason, mirroring PTR-20's rule. */
export const VENUE_REJECTION_REASON_REQUIRED = "Enter a reason to reject this request";
export const VENUE_REJECTION_REASON_MAX_LENGTH = 2000;
/** PTR-37: releasing an approved booking requires a concise operational reason. */
export const VENUE_RELEASE_REASON_REQUIRED = "Enter a reason to release this booking";
/** PTR-137 AC4: the Coordinator may release a booking only while a venue block suspends it. */
export const VENUE_BOOKING_NOT_BLOCKED_MESSAGE =
  "Only a booking suspended by a venue block can be released by its Coordinator.";
export const VENUE_RELEASE_REASON_MAX_LENGTH = 2000;
/** PTR-34 criterion 2: a suggested window needs both ends, or neither. */
export const VENUE_REJECTION_TIME_PAIR_MESSAGE = "Enter both a start and end time";

/**
 * PTR-36 criterion 2: Name the venue and conflicting period in the refusal, but not the other
 * event's name. This keeps Venue Staff's projection anonymous (PTR-8/PTR-31). The loader returns
 * times as `YYYY-MM-DDTHH:MM:SS`. Format them as wall-clock values with `formatLocalDateTime`.
 */
export function venueRequestConflictMessage(
  conflict: {
    venueName: string;
    startsAt: string;
    endsAt: string;
  },
  phrase = "already booked"
) {
  // A period that crosses midnight names its end date too; within one civil day the shared date
  // reads once.
  const startsAt = conflict.startsAt.replace(" ", "T");
  const endsAt = conflict.endsAt.replace(" ", "T");
  const start = formatLocalDateTime(startsAt.slice(0, 16));
  const end =
    endsAt.slice(0, 10) === startsAt.slice(0, 10)
      ? endsAt.slice(11, 16)
      : formatLocalDateTime(endsAt.slice(0, 16));
  return `${conflict.venueName} is ${phrase} ${start} – ${end}`;
}

/**
 * PTR-138 AC1: the session requirements that one venue request carries. They start from the
 * event's requirements. Blank text states no requirement. Attendance is null when neither the
 * session nor the event states one.
 */
export interface SessionRequirements {
  expectedAttendance: number | null;
  layout: string;
  accessibilityRequirements: string;
  requiredFacilities: string;
}

const Time = z.string().regex(TIME_SHAPE, VENUE_REQUEST_TIME_MESSAGE);
const EventId = z.int32({ error: VENUE_SEARCH_EVENT_MESSAGE }).positive(VENUE_SEARCH_EVENT_MESSAGE);
const VenueId = z.int32({ error: VENUE_ID_MESSAGE }).positive(VENUE_ID_MESSAGE);
const REQUIREMENT_TOO_LONG_MESSAGE = `Enter ${VENUE_SEARCH_TEXT_MAX_LENGTH} characters or fewer for each requirement`;
const RequirementText = z
  .string()
  .trim()
  .max(VENUE_SEARCH_TEXT_MAX_LENGTH, REQUIREMENT_TOO_LONG_MESSAGE);

/**
 * PTR-138 AC1: the optional session requirements of a new request. An absent key takes the
 * event's requirement. Blank text states no requirement. A layout must name a supported layout,
 * as the search requires, so a typo cannot fail every venue.
 */
const SessionRequirementShape = {
  expectedAttendance: z
    .int32({ error: VENUE_SEARCH_ATTENDANCE_MESSAGE })
    .positive(VENUE_SEARCH_ATTENDANCE_MESSAGE)
    .optional(),
  layout: RequirementText.refine(
    value => value === "" || parseLayouts(value).length > 0,
    LAYOUT_MESSAGE
  ).optional(),
  accessibilityRequirements: RequirementText.optional(),
  requiredFacilities: RequirementText.optional(),
};

/**
 * PTR-31 criterion 1: Require a venue, date, start time, and end time. Fixed-width `HH:MM` strings
 * compare as times, so the refinement can use a string comparison without building a `Date`.
 * Allow one civil day only. A window past midnight does not fit a daily window, as
 * `crossesMidnight` rejects for PTR-29.
 */
export const VenueRequestInput = z
  .object({
    eventId: EventId,
    venueId: VenueId,
    date: z.iso.date({ error: VENUE_REQUEST_DATE_MESSAGE }),
    startTime: Time,
    endTime: Time,
    ...SessionRequirementShape,
  })
  .refine(value => `${value.date}T${value.endTime}` > `${value.date}T${value.startTime}`, {
    path: ["endTime"],
    message: VENUE_REQUEST_TIME_ORDER_MESSAGE,
  });

export type VenueRequestValues = z.infer<typeof VenueRequestInput>;

/** The session requirements a request or a hold conversion may state. */
export type SessionRequirementInput = Pick<
  VenueRequestValues,
  "expectedAttendance" | "layout" | "accessibilityRequirements" | "requiredFacilities"
>;

/**
 * What the venue page carries into the request form: the search's window and session values, or
 * an adjusted request's (PTR-35). The route's search schema checks the shape of each value.
 */
export type VenueRequestPrefill = Partial<
  Pick<VenueRequestValues, "date" | "startTime" | "endTime"> & SessionRequirementInput
>;

/** The session requirements as the request and hold-conversion forms hold them: text. */
export interface SessionRequirementFormValues {
  expectedAttendance: string;
  layout: string;
  accessibilityRequirements: string;
  requiredFacilities: string;
}

/** The session inputs that both forms show, in order, with the search's wording. */
export const SESSION_REQUIREMENT_INPUTS: readonly {
  name: keyof SessionRequirementFormValues;
  label: string;
  type: "number" | "text";
  placeholder?: string;
}[] = [
  { name: "expectedAttendance", label: "Expected attendance", type: "number" },
  { name: "layout", label: "Layout", type: "text", placeholder: "Theatre, classroom, banquet…" },
  {
    name: "accessibilityRequirements",
    label: "Accessibility",
    type: "text",
    placeholder: "Comma-separated features",
  },
  {
    name: "requiredFacilities",
    label: "Facilities",
    type: "text",
    placeholder: "Comma-separated facilities",
  },
];

/** Start the session inputs from stated requirements. A null attendance shows as a blank input. */
export function sessionRequirementFormValues(
  requirements: SessionRequirements
): SessionRequirementFormValues {
  return {
    expectedAttendance:
      requirements.expectedAttendance === null ? "" : String(requirements.expectedAttendance),
    layout: requirements.layout,
    accessibilityRequirements: requirements.accessibilityRequirements,
    requiredFacilities: requirements.requiredFacilities,
  };
}

/**
 * Read the session inputs as request input. A blank attendance leaves the key out, so the server
 * uses the event's figure. Blank text stays, because it states no requirement.
 */
export function sessionRequirementInput(
  values: SessionRequirementFormValues
): SessionRequirementInput {
  const attendance = values.expectedAttendance.trim();
  return {
    ...(attendance === "" ? {} : { expectedAttendance: Number(attendance) }),
    layout: values.layout,
    accessibilityRequirements: values.accessibilityRequirements,
    requiredFacilities: values.requiredFacilities,
  };
}

/**
 * PTR-138 AC1: name a session by its attendance and layout (`layoutLabel`), for example "30
 * attendees, Boardroom". Return "" when the session states neither.
 */
export function formatSessionSummary(
  requirements: Pick<SessionRequirements, "expectedAttendance" | "layout">
): string {
  const parts: string[] = [];
  const attendance = requirements.expectedAttendance;
  if (attendance !== null)
    parts.push(`${attendance} ${attendance === 1 ? "attendee" : "attendees"}`);
  const layout = requirements.layout.trim();
  if (layout) parts.push(layoutLabel(layout));
  return parts.join(", ");
}

/** The venue page's selection: which event and venue the request panel is asking about. */
export const VenueRequestContextInput = z.object({ eventId: EventId, venueId: VenueId });

export type VenueRequestContextSelection = z.infer<typeof VenueRequestContextInput>;

/**
 * Validate an id as text, not as a UUID. The column and seed fixture use text ids, so a UUID check
 * would reject a request the UI can show.
 */
export const VenueRequestIdInput = z.object(
  {
    id: z
      .string({ error: VENUE_REQUEST_ID_MESSAGE })
      .trim()
      .min(1, VENUE_REQUEST_ID_MESSAGE)
      .max(64, VENUE_REQUEST_ID_MESSAGE),
  },
  { error: VENUE_REQUEST_ID_MESSAGE }
);

export type VenueRequestId = z.infer<typeof VenueRequestIdInput>;

/**
 * PTR-138 AC1: convert a hold with the session requirements that the new request carries. An
 * absent requirement takes the event's requirement, as for a new request.
 */
export const VenueHoldConversionInput = z.object(
  { id: VenueRequestIdInput.shape.id, ...SessionRequirementShape },
  { error: VENUE_REQUEST_ID_MESSAGE }
);

export type VenueHoldConversion = z.infer<typeof VenueHoldConversionInput>;

export function parseVenueHoldConversion(data: unknown): VenueHoldConversion {
  const parsed = VenueHoldConversionInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * Validate a form's input with the server's schema. Mark each field with its first issue, in the
 * shape that a TanStack Form `onSubmit` validator returns. Return `undefined` for valid input.
 */
export function formIssues(
  schema: z.ZodType,
  input: unknown
): { fields: Record<string, { message: string }> } | undefined {
  const parsed = schema.safeParse(input);
  if (parsed.success) return undefined;
  const fields: Record<string, { message: string }> = {};
  for (const issue of parsed.error.issues) {
    fields[String(issue.path[0])] ??= { message: issue.message };
  }
  return { fields };
}

/** Server-function and form boundary: typed values or the first readable refusal. */
export function parseVenueRequestInput(data: unknown): VenueRequestValues {
  const parsed = VenueRequestInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export function parseVenueRequestId(data: unknown): VenueRequestId {
  const parsed = VenueRequestIdInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export function parseVenueRequestContext(data: unknown): VenueRequestContextSelection {
  const parsed = VenueRequestContextInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/** The Venue Staff event page's selection: the event whose pending requests it decides. */
export const VenueRequestEventInput = z.object({ eventId: EventId });

export function parseVenueRequestEventInput(data: unknown): z.infer<typeof VenueRequestEventInput> {
  const parsed = VenueRequestEventInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * PTR-34 criteria 1 and 2: Require a reason for rejection and accept any alternative Venue Staff
 * choose to suggest. Suggestion fields are independent and optional, except start and end times.
 * Require the end time to follow the start time, as for the request itself.
 */
export const VenueRejectionInput = z
  .object({
    id: VenueRequestIdInput.shape.id,
    reason: z
      .string({ error: VENUE_REJECTION_REASON_REQUIRED })
      .trim()
      .min(1, VENUE_REJECTION_REASON_REQUIRED)
      .max(
        VENUE_REJECTION_REASON_MAX_LENGTH,
        `Rejection reason must be ${VENUE_REJECTION_REASON_MAX_LENGTH} characters or fewer`
      ),
    suggestedVenueId: VenueId.optional(),
    suggestedDate: z.iso.date({ error: VENUE_REQUEST_DATE_MESSAGE }).optional(),
    suggestedStartTime: Time.optional(),
    suggestedEndTime: Time.optional(),
  })
  .superRefine((value, context) => {
    const { suggestedStartTime: start, suggestedEndTime: end } = value;
    if ((start === undefined) !== (end === undefined)) {
      context.addIssue({
        code: "custom",
        path: [start === undefined ? "suggestedStartTime" : "suggestedEndTime"],
        message: VENUE_REJECTION_TIME_PAIR_MESSAGE,
      });
    } else if (start !== undefined && end !== undefined && end <= start) {
      context.addIssue({
        code: "custom",
        path: ["suggestedEndTime"],
        message: VENUE_REQUEST_TIME_ORDER_MESSAGE,
      });
    }
  });

export type VenueRejectionValues = z.infer<typeof VenueRejectionInput>;

/** PTR-37: a release is a state transition on an approved booking, not a withdrawal of a pending request. */
export const VenueReleaseInput = z.object({
  id: VenueRequestIdInput.shape.id,
  reason: z
    .string({ error: VENUE_RELEASE_REASON_REQUIRED })
    .trim()
    .min(1, VENUE_RELEASE_REASON_REQUIRED)
    .max(
      VENUE_RELEASE_REASON_MAX_LENGTH,
      `Release reason must be ${VENUE_RELEASE_REASON_MAX_LENGTH} characters or fewer`
    ),
});

export type VenueReleaseValues = z.infer<typeof VenueReleaseInput>;

/** PTR-37: an amendment keeps the booking row and applies the same strict overlap rule as approval. */
export const VenueAmendmentInput = z
  .object({
    id: VenueRequestIdInput.shape.id,
    venueId: VenueId,
    date: z.iso.date({ error: VENUE_REQUEST_DATE_MESSAGE }),
    startTime: Time,
    endTime: Time,
  })
  .refine(value => `${value.date}T${value.endTime}` > `${value.date}T${value.startTime}`, {
    path: ["endTime"],
    message: VENUE_REQUEST_TIME_ORDER_MESSAGE,
  });

export type VenueAmendmentValues = z.infer<typeof VenueAmendmentInput>;

/**
 * PTR-34 criterion 2: Return the parts of the suggestion that Venue Staff gave, with `null` for
 * the rest. The email and Coordinator's event card share this shape. Times use `HH:MM`.
 */
export interface VenueSuggestion {
  venueName: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}

/**
 * PTR-34: Join the suggestion fields into one line for the Coordinator's event card and rejection
 * email. The card and email pass their own `formatDate` because they format dates differently.
 * Label a time-only suggestion as "New time: …" so it does not appear as an unattached time range.
 */
export function formatVenueSuggestion(
  suggestion: VenueSuggestion,
  formatDate: (date: string) => string
): string {
  const parts = [suggestion.venueName, suggestion.date && formatDate(suggestion.date)].filter(
    (part): part is string => Boolean(part)
  );
  if (suggestion.startTime && suggestion.endTime) {
    const time = `${suggestion.startTime}–${suggestion.endTime}`;
    parts.push(parts.length === 0 ? `New time: ${time}` : time);
  }
  return parts.join(", ");
}

/** The states of one venue request, as the `venue_request_status` enum stores them. */
export type VenueRequestStatus = "pending" | "withdrawn" | "approved" | "rejected" | "released";

/** PTR-138: the plain-language label every screen shows for a venue-request state. */
export const VENUE_REQUEST_STATUS_LABELS: Record<VenueRequestStatus, string> = {
  pending: "Pending",
  withdrawn: "Withdrawn",
  approved: "Approved",
  rejected: "Rejected",
  released: "Released",
};

/** The fields of one row that decide whether a later request answers it. */
export interface VenueRequestAnswerRow {
  id: string;
  status: VenueRequestStatus;
  venueId: number;
  suggestedVenueId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PTR-35, PTR-139, PTR-137: Decide whether the Coordinator answered this row with a later
 * request. A rejected row is answered at the venue Venue Staff suggested, else at its own venue,
 * by a non-withdrawn request raised after the rejection (`updatedAt`). A released row is answered
 * by a non-withdrawn request at any venue raised after the booking itself (`createdAt`): the
 * release abandons its venue, and the replacement is arranged before the release and may land
 * elsewhere (PTR-137). The venue-request card and the confirmation gate both read this rule, so
 * they cannot drift.
 */
export function answeredByLaterRequest(
  row: VenueRequestAnswerRow,
  rows: readonly VenueRequestAnswerRow[]
): boolean {
  // Only a settled row can be answered. A pending or approved row stands on its own.
  if (row.status !== "rejected" && row.status !== "released") return false;
  if (row.status === "rejected") {
    const targetVenueId = row.suggestedVenueId ?? row.venueId;
    return rows.some(
      other =>
        other.id !== row.id &&
        other.status !== "withdrawn" &&
        other.venueId === targetVenueId &&
        other.createdAt.getTime() > row.updatedAt.getTime()
    );
  }
  return rows.some(
    other =>
      other.id !== row.id &&
      other.status !== "withdrawn" &&
      other.createdAt.getTime() > row.createdAt.getTime()
  );
}

/**
 * PTR-36, PTR-138 AC1: why approval would refuse a pending request now. It overlaps an approved
 * booking or a held hold once the buffers count, or the venue cannot host its window: the venue is
 * closed then, or a recorded block overlaps it.
 */
export type VenueRequestConflict = "booking" | "hold" | "unavailable";

/** The badge label for each conflict kind. */
export const VENUE_REQUEST_CONFLICT_LABELS: Record<VenueRequestConflict, string> = {
  booking: "Conflicting booking",
  hold: "Conflicting hold",
  unavailable: "Venue unavailable",
};

/**
 * Map each venue-request state to a `Badge` variant, as `EVENT_REQUEST_STATUS_VARIANTS` does.
 * Use `progress` (amber) for a request that waits, `confirmed` (harbor) for a held booking, and
 * `stopped` (coral) for a refused or released one. A withdrawn request is neutral `outline`.
 */
type VenueRequestStatusVariant = "outline" | "progress" | "confirmed" | "stopped";
export const VENUE_REQUEST_STATUS_VARIANTS: Record<VenueRequestStatus, VenueRequestStatusVariant> =
  {
    pending: "progress",
    withdrawn: "outline",
    approved: "confirmed",
    rejected: "stopped",
    released: "stopped",
  };

export function parseVenueRejectionInput(data: unknown): VenueRejectionValues {
  const parsed = VenueRejectionInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export function parseVenueReleaseInput(data: unknown): VenueReleaseValues {
  const parsed = VenueReleaseInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export function parseVenueAmendmentInput(data: unknown): VenueAmendmentValues {
  const parsed = VenueAmendmentInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

/**
 * PTR-109 AC2: the refusal when a tentative hold or approval conflicts with an active tentative hold.
 * Explicitly names the conflicting venue and period.
 */
export function venueHoldConflictMessage(conflict: {
  venueName: string;
  startsAt: string;
  endsAt: string;
}) {
  return venueRequestConflictMessage(conflict, "tentatively held");
}

/**
 * PTR-138 AC1: the phrase of the refusal for a window that the venue cannot host, because it is
 * closed then or a recorded block overlaps it. Approval and amendment give it.
 */
export const VENUE_UNAVAILABLE_PHRASE = "cannot host this window";

/** PTR-138 AC1: the phrase of the refusal for a venue that fails a session's requirements. */
export const VENUE_REQUIREMENTS_PHRASE = "does not meet this session's requirements";

/** PTR-138: the phrase of the refusal for an event outside `SEARCHABLE_EVENT_STATUSES`. */
export const VENUE_EVENT_STATUS_PHRASE = "cannot take a new venue booking";

/** The state that a venue block puts a venue in. `VENUE_BLOCK_PHRASE` contains it. */
const VENUE_BLOCK_STATE = "unavailable";

/**
 * The phrase of the refusal for a commitment that overlaps an active venue block
 * (`venueBlockConflictMessage`). The approve button shows a refusal that contains it.
 */
export const VENUE_BLOCK_PHRASE = `is ${VENUE_BLOCK_STATE}`;

/**
 * The refusal for a booking, a hold or a block that overlaps an active venue block. A finite block
 * uses the booking message with the block state. A null end gives "until lifted", never year
 * 9999. Times use the same `formatLocalDateTime` format as the booking message.
 */
export function venueBlockConflictMessage(conflict: {
  venueName: string;
  startsAt: string;
  endsAt: string | null;
}) {
  const { venueName, startsAt, endsAt } = conflict;
  if (endsAt === null) {
    const start = formatLocalDateTime(startsAt.replace(" ", "T").slice(0, 16));
    return `${venueName} ${VENUE_BLOCK_PHRASE} from ${start} until lifted`;
  }
  return venueRequestConflictMessage({ venueName, startsAt, endsAt }, VENUE_BLOCK_STATE);
}

/**
 * List the phrases of the approval refusals that name a reason, so the approve button can show
 * them and hide other failures without matching the full text. `venueRequestConflictMessage` and
 * `VENUE_OCCUPANCY_CONFLICT_MESSAGE` say "already booked", and `venueHoldConflictMessage` says
 * "tentatively held". The other phrases are above.
 */
export const VENUE_CONFLICT_PHRASES = [
  "already booked",
  "tentatively held",
  VENUE_UNAVAILABLE_PHRASE,
  VENUE_REQUIREMENTS_PHRASE,
  VENUE_EVENT_STATUS_PHRASE,
  VENUE_BLOCK_PHRASE,
] as const;

export function isVenueConflictMessage(message: string): boolean {
  return VENUE_CONFLICT_PHRASES.some(phrase => message.includes(phrase));
}

export const parseVenueHoldInput = parseVenueRequestInput;
export const parseVenueHoldId = parseVenueRequestId;

export const VENUE_HOLD_EXPIRY_MESSAGE = "Enter a valid expiry date and time";
export const VENUE_HOLD_WARNING_MESSAGE = "Enter a valid warning date and time";
export const VENUE_HOLD_EXPIRY_PAST_MESSAGE = "The expiry must be in the future";
/** A warning refers to the expiry, so the hold must have an expiry first. */
export const VENUE_HOLD_WARNING_NEEDS_EXPIRY_MESSAGE = "Set the hold expiry before the warning";
export const VENUE_HOLD_WARNING_PAST_MESSAGE = "The warning must be in the future";
export const VENUE_HOLD_WARNING_ORDER_MESSAGE = "The warning must come before the hold expires";
/** Venue Staff cannot read the warning, so the refusal names no time. */
export const VENUE_HOLD_EXPIRY_BEFORE_WARNING_MESSAGE =
  "The expiry must come after the Coordinator's warning time";

/** The shape of `<input type="datetime-local">`. It is venue-local and has no seconds or offset. */
export const HoldLocalDateTime = LocalDateTime;

/**
 * PTR-142 AC1: Venue Staff set or change the expiry of a hold. The expiry is a venue-local time,
 * like the period of the hold.
 */
export const VenueHoldExpiryInput = z.object({
  id: VenueRequestIdInput.shape.id,
  expiresAt: HoldLocalDateTime(VENUE_HOLD_EXPIRY_MESSAGE),
});

export function parseVenueHoldExpiry(data: unknown): z.infer<typeof VenueHoldExpiryInput> {
  const parsed = VenueHoldExpiryInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * PTR-142 AC3: the Coordinator sets the warning time of a hold, or clears it with `null`. The time
 * is fixed. It is not an offset from the expiry.
 */
export const VenueHoldWarningInput = z.object({
  id: VenueRequestIdInput.shape.id,
  warnAt: HoldLocalDateTime(VENUE_HOLD_WARNING_MESSAGE).nullable(),
});

export function parseVenueHoldWarning(data: unknown): z.infer<typeof VenueHoldWarningInput> {
  const parsed = VenueHoldWarningInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** PTR-150 AC6: a hold request that another Venue Staff member placed or declined first. */
export const VENUE_HOLD_REQUEST_HANDLED_MESSAGE = "This hold request was already handled";

/**
 * Whether a refusal means that the request has left the queue: another member handled it, or its
 * event can no longer take a hold. The queue then reloads without the request, so the refusal
 * must show outside its card.
 */
export function leftHoldQueue(message: string): boolean {
  return (
    message === VENUE_HOLD_REQUEST_HANDLED_MESSAGE || message.includes(VENUE_EVENT_STATUS_PHRASE)
  );
}
export const VENUE_HOLD_DECLINE_REASON_REQUIRED = "Enter a reason to decline this hold request";
export const VENUE_HOLD_DECLINE_REASON_MAX_LENGTH = 2000;

/** PTR-150 AC3: Venue Staff place a hold request with an expiry, as the expiry action sets one. */
export const parseVenueHoldPlacement = parseVenueHoldExpiry;

/** PTR-150 AC5: Venue Staff decline a hold request and owe the Coordinator a reason. */
export const VenueHoldDeclineInput = z.object({
  id: VenueRequestIdInput.shape.id,
  reason: z
    .string({ error: VENUE_HOLD_DECLINE_REASON_REQUIRED })
    .trim()
    .min(1, VENUE_HOLD_DECLINE_REASON_REQUIRED)
    .max(
      VENUE_HOLD_DECLINE_REASON_MAX_LENGTH,
      `Decline reason must be ${VENUE_HOLD_DECLINE_REASON_MAX_LENGTH} characters or fewer`
    ),
});

export function parseVenueHoldDecline(data: unknown): z.infer<typeof VenueHoldDeclineInput> {
  const parsed = VenueHoldDeclineInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
