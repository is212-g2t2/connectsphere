import { z } from "zod";

import { formatLocalDateTime } from "#/features/event-requests/format";
import { TIME_SHAPE, VENUE_ID_MESSAGE, VENUE_SEARCH_EVENT_MESSAGE } from "#/features/venues/schema";

/**
 * Pure data and Zod only: routes and the form import this module, so per AGENTS.md nothing here
 * may reach `#/db/schema` or any other server-only dependency.
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
/**
 * PTR-36: the backstop sentence when the exclusion constraint refuses a write the locked
 * pre-check did not see — a writer outside `handleApproveVenueRequest`.
 */
export const VENUE_REQUEST_CONFLICT_MESSAGE =
  "This venue is already booked for an overlapping period.";

/** PTR-34: a rejected request is final; the Coordinator raises a new one instead. */
export const VENUE_REQUEST_REJECTED_MESSAGE =
  "This request was rejected. Raise a new request instead.";
/** PTR-34 criterion 1: Venue Staff owe the Coordinator a reason, mirroring PTR-20's rule. */
export const VENUE_REJECTION_REASON_REQUIRED = "Enter a reason to reject this request";
export const VENUE_REJECTION_REASON_MAX_LENGTH = 2000;
/** PTR-34 criterion 2: a suggested window needs both ends, or neither. */
export const VENUE_REJECTION_TIME_PAIR_MESSAGE = "Enter both a start and end time";

/**
 * PTR-36 criterion 2: the refusal names the venue and the conflicting period, never the other
 * event's name — Venue Staff keep the nameless projection PTR-8/PTR-31 established. The times
 * arrive in the loader's normalized `YYYY-MM-DDTHH:MM:SS` spelling and are read the way the rest
 * of the app reads wall-clock values (`formatLocalDateTime`), not as the stored string.
 */
export function venueRequestConflictMessage(conflict: {
  venueName: string;
  startsAt: string;
  endsAt: string;
}) {
  // A period that crosses midnight names its end date too; within one civil day the shared date
  // reads once.
  const start = formatLocalDateTime(conflict.startsAt.slice(0, 16));
  const end =
    conflict.endsAt.slice(0, 10) === conflict.startsAt.slice(0, 10)
      ? conflict.endsAt.slice(11, 16)
      : formatLocalDateTime(conflict.endsAt.slice(0, 16));
  return `${conflict.venueName} is already booked ${start} – ${end}`;
}

const Time = z.string().regex(TIME_SHAPE, VENUE_REQUEST_TIME_MESSAGE);
const EventId = z.int32({ error: VENUE_SEARCH_EVENT_MESSAGE }).positive(VENUE_SEARCH_EVENT_MESSAGE);
const VenueId = z.int32({ error: VENUE_ID_MESSAGE }).positive(VENUE_ID_MESSAGE);

/**
 * PTR-31 criterion 1: a venue, a civil date and a start/end time — all required. Fixed-width
 * `HH:MM` strings compare as times, so the refinement is a string comparison and no `Date` is
 * built, the same reasoning the search filters follow. One civil day only: a window running past
 * midnight fits no daily hosting window, exactly as `crossesMidnight` refuses in PTR-29.
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

/** The venue page's selection: which event and venue the request panel is asking about. */
export const VenueRequestContextInput = z.object({ eventId: EventId, venueId: VenueId });

export type VenueRequestContextSelection = z.infer<typeof VenueRequestContextInput>;

/**
 * A text id, not `z.uuid()`: the column is text and the seed's fixture row spells its own id, so
 * a shape check would refuse a request the UI can legitimately show.
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
 * PTR-34 criteria 1 and 2: a rejection is a reason, plus whatever alternative Venue Staff choose
 * to suggest. Every part of the suggestion is optional and independent; only a time is a pair,
 * and its end must come after its start, the rule the request itself follows.
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

export function parseVenueRejectionInput(data: unknown): VenueRejectionValues {
  const parsed = VenueRejectionInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}
