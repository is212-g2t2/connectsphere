import { z } from "zod";

import { formatLocalDateTime, formatVenuePeriod } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  LAYOUT_LABELS,
  LAYOUT_MESSAGE,
  TIME_SHAPE,
  VENUE_ID_MESSAGE,
  VENUE_SEARCH_ATTENDANCE_MESSAGE,
  VENUE_SEARCH_EVENT_MESSAGE,
  VENUE_SEARCH_TEXT_MAX_LENGTH,
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
 * The partial unique index on `(event_id, venue_id, starts_at, ends_at)` answers an exact
 * double-submit with this message, not a driver error.
 */
export const VENUE_REQUEST_DUPLICATE_MESSAGE =
  "This event already has a pending request for this venue and window.";
export const VENUE_REQUEST_SETTLED_MESSAGE =
  "This request has already been settled and can no longer be withdrawn.";
/** PTR-36: a request that is no longer pending cannot be approved again. */
export const VENUE_REQUEST_DECIDED_MESSAGE = "This request has already been decided.";

/**
 * PTR-138: approval refuses a request when its event is outside `SEARCHABLE_EVENT_STATUSES`, for
 * example after confirmation or rejection. Name the status in the words that the status badge uses.
 */
export function venueRequestEventStatusMessage(status: EventRequestStatus): string {
  const label = EVENT_REQUEST_STATUS_LABELS[status].toLowerCase();
  return `This event is ${label}, so it cannot take a new venue booking.`;
}
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
 * PTR-138 AC4: refuse a window that overlaps a pending request or an approved booking of the same
 * event at the same venue. Name that request's window and state. The venue's setup and turnaround
 * time count between two sessions of one event, as approval counts them (ADR-7), so the message
 * says so when the venue has buffers.
 */
export function venueRequestEventOverlapMessage(overlap: {
  venueName: string;
  status: "pending" | "approved";
  startsAt: string;
  endsAt: string;
  buffered: boolean;
}): string {
  const existing = overlap.status === "approved" ? "approved booking" : "pending request";
  const period = formatVenuePeriod(overlap.startsAt, overlap.endsAt);
  const buffers = overlap.buffered ? ", including the venue's setup and turnaround time" : "";
  return `This window overlaps this event's ${existing} for ${overlap.venueName} on ${period}${buffers}.`;
}

/**
 * PTR-138 AC1: refuse a venue that does not meet the session's requirements. List every failure
 * in the words that search uses, for example "Room B does not meet this session's requirements:
 * Holds 40; 120 needed. Missing facilities: projector."
 */
export function venueRequirementsMessage(venueName: string, failures: readonly string[]): string {
  return `${venueName} does not meet this session's requirements: ${failures.join(". ")}.`;
}

/**
 * PTR-138 AC1: the session requirements that one venue request carries. They start from the
 * event's requirements. Blank text states no requirement. Attendance is null when neither the
 * session nor the event states one.
 */
export interface SessionRequirements {
  expectedAttendance: number | null;
  layout: string;
  accessibility: string;
  facilities: string;
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
const SessionRequirementFields = {
  expectedAttendance: z
    .int32({ error: VENUE_SEARCH_ATTENDANCE_MESSAGE })
    .positive(VENUE_SEARCH_ATTENDANCE_MESSAGE)
    .optional(),
  layout: RequirementText.refine(
    value => value === "" || parseLayouts(value).length > 0,
    LAYOUT_MESSAGE
  ).optional(),
  accessibility: RequirementText.optional(),
  facilities: RequirementText.optional(),
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
    ...SessionRequirementFields,
  })
  .refine(value => `${value.date}T${value.endTime}` > `${value.date}T${value.startTime}`, {
    path: ["endTime"],
    message: VENUE_REQUEST_TIME_ORDER_MESSAGE,
  });

export type VenueRequestValues = z.infer<typeof VenueRequestInput>;

/** The session requirements a request or a hold conversion may state. */
export type SessionRequirementInput = Pick<
  VenueRequestValues,
  "expectedAttendance" | "layout" | "accessibility" | "facilities"
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
  accessibility: string;
  facilities: string;
}

/** The session inputs that both forms show, in order, with the search's wording. */
export const SESSION_REQUIREMENT_INPUTS = [
  { name: "expectedAttendance", label: "Expected attendance", type: "number", placeholder: "" },
  { name: "layout", label: "Layout", type: "text", placeholder: "Theatre, classroom, banquet…" },
  {
    name: "accessibility",
    label: "Accessibility",
    type: "text",
    placeholder: "Comma-separated features",
  },
  {
    name: "facilities",
    label: "Facilities",
    type: "text",
    placeholder: "Comma-separated facilities",
  },
] as const;

/** Start the session inputs from stated requirements. A null attendance shows as a blank input. */
export function sessionRequirementFormValues(
  requirements: SessionRequirements
): SessionRequirementFormValues {
  return {
    expectedAttendance:
      requirements.expectedAttendance === null ? "" : String(requirements.expectedAttendance),
    layout: requirements.layout,
    accessibility: requirements.accessibility,
    facilities: requirements.facilities,
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
    accessibility: values.accessibility,
    facilities: values.facilities,
  };
}

/**
 * PTR-138 AC1: name a session by its attendance and layout, for example "30 attendees,
 * Boardroom". Show a named layout by its label and other text as stored. Return "" when the
 * session states neither.
 */
export function formatSessionSummary(
  requirements: Pick<SessionRequirements, "expectedAttendance" | "layout">
): string {
  const parts: string[] = [];
  const attendance = requirements.expectedAttendance;
  if (attendance !== null)
    parts.push(`${attendance} ${attendance === 1 ? "attendee" : "attendees"}`);
  const layout = requirements.layout.trim();
  if (layout) {
    const named = parseLayouts(layout).map(name => LAYOUT_LABELS[name]);
    parts.push(named.length > 0 ? named.join(", ") : layout);
  }
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
  { id: VenueRequestIdInput.shape.id, ...SessionRequirementFields },
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
 * List venue-conflict messages so the client can distinguish conflicts from other failures
 * without matching the full text. Include named booking or hold messages and the generic
 * fallback. `venueRequestConflictMessage` and `VENUE_OCCUPANCY_CONFLICT_MESSAGE` say "already
 * booked"; `venueHoldConflictMessage` says "tentatively held".
 */
export const VENUE_CONFLICT_PHRASES = ["already booked", "tentatively held"] as const;

export function isVenueConflictMessage(message: string): boolean {
  return VENUE_CONFLICT_PHRASES.some(phrase => message.includes(phrase));
}

export const parseVenueHoldInput = parseVenueRequestInput;
export const parseVenueHoldId = parseVenueRequestId;
