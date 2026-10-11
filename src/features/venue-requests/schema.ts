import { z } from "zod";

import { formatLocalDateTime } from "#/features/event-requests/format";
import { TIME_SHAPE, VENUE_ID_MESSAGE, VENUE_SEARCH_EVENT_MESSAGE } from "#/features/venues/schema";

/**
 * Routes and the form import this module. Keep it free of `#/db/schema` and other server-only dependencies.
 */

export const VENUE_REQUEST_DATE_MESSAGE = "Choose a date";
export const VENUE_REQUEST_TIME_MESSAGE = "Enter start and end times as HH:MM";
export const VENUE_REQUEST_TIME_ORDER_MESSAGE = "End time must be later than start time";
export const VENUE_REQUEST_ID_MESSAGE = "Choose a booking request";
/** The partial unique index on `(event_id, venue_id)` answers with this rather than a driver error. */
export const VENUE_REQUEST_DUPLICATE_MESSAGE =
  "A request for this venue is already pending for this event";
export const VENUE_REQUEST_SETTLED_MESSAGE =
  "This request has already been settled and can no longer be withdrawn.";
/** PTR-36: a request that is no longer pending cannot be approved again. */
export const VENUE_REQUEST_DECIDED_MESSAGE = "This request has already been decided.";
export const VENUE_BOOKING_NOT_APPROVED_MESSAGE =
  "Only an approved booking can be released or amended.";
/**
 * PTR-36: The fallback message when the exclusion constraint rejects an overlap the locked
 * pre-check missed, such as a write outside `handleApproveVenueRequest`.
 */
export const VENUE_REQUEST_CONFLICT_MESSAGE =
  "This venue is already booked for an overlapping period.";

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

const Time = z.string().regex(TIME_SHAPE, VENUE_REQUEST_TIME_MESSAGE);
const EventId = z.int32({ error: VENUE_SEARCH_EVENT_MESSAGE }).positive(VENUE_SEARCH_EVENT_MESSAGE);
const VenueId = z.int32({ error: VENUE_ID_MESSAGE }).positive(VENUE_ID_MESSAGE);

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
  })
  .refine(value => `${value.date}T${value.endTime}` > `${value.date}T${value.startTime}`, {
    path: ["endTime"],
    message: VENUE_REQUEST_TIME_ORDER_MESSAGE,
  });

export type VenueRequestValues = z.infer<typeof VenueRequestInput>;

/** The window an adjusted request arrives with, shape-validated by the route's search schema. */
export type VenueRequestPrefill = Pick<VenueRequestValues, "date" | "startTime" | "endTime">;

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
 * PTR-109: Generic fallback when `venue_holds_no_overlap` rejects an overlap missed by the locked
 * pre-check, such as a write outside `handleCreateVenueHold`. Handler callers hold the advisory
 * lock and receive the named refusal above instead.
 */
export const VENUE_HOLD_OVERLAP_MESSAGE =
  "This venue is tentatively held for an overlapping period.";

/**
 * List venue-conflict messages so the client can distinguish conflicts from other failures
 * without matching the full text. Include named booking or hold messages and both generic
 * fallbacks. `venueRequestConflictMessage` says "already booked"; `venueHoldConflictMessage` says
 * "tentatively held".
 */
export const VENUE_CONFLICT_PHRASES = ["already booked", "tentatively held"] as const;

export function isVenueConflictMessage(message: string): boolean {
  return VENUE_CONFLICT_PHRASES.some(phrase => message.includes(phrase));
}

export const parseVenueHoldInput = parseVenueRequestInput;
export const parseVenueHoldId = parseVenueRequestId;
