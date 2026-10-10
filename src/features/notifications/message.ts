import { z } from "zod";

import { ARRANGEMENT_STATES } from "#/features/equipment-requests/schema";
import { SIGNIFICANT_FIELDS } from "#/features/event-requests/schema";

/**
 * PTR-55: the notification kinds the application raises. The Postgres enum in
 * `#/db/schema` restates this list; `tests/unit/db-schema.test.ts` holds the two identical.
 * `kind` selects the email template at delivery time, so a new kind means a new payload schema,
 * a summary, a href and a template arm in `render.server.ts`.
 */
export const NOTIFICATION_KINDS = [
  "venue_booking_requested",
  "venue_booking_approved",
  "venue_booking_rejected",
  "venue_booking_changed",
  "clarification_requested",
  "clarification_replied",
  "event_change_requested",
  "handover_requested",
  "handover_accepted",
  "handover_declined",
  "event_decided",
  "event_confirmed",
  "equipment_requested",
  "equipment_arrangements_completed",
  "equipment_unavailable",
  "equipment_released",
  "event_registered",
  "registration_threshold_reached",
  "event_cancellation_requested",
  "event_cancelled",
  "event_cancellation_declined",
  /** PTR-47 AC4: a withdrawal freed a place from an event that was at its registration capacity. */
  "registration_place_freed",
  "registration_opened",
  "registration_closed",
  /** PTR-23 AC5: a significant change was saved on an event holding the recipient's arrangement. */
  "event_significant_change",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The payloads are domain facts, never React props: the inbox line, the email subject and the
 * email body are all derived from them, and `render.server.ts` is the one place that maps a
 * payload to a template. Dates and times keep the spelling they were read with (venue-local
 * floating strings), so nothing shifts between write and render.
 */
const VenueSuggestionSchema = z.object({
  venueName: z.string().nullable(),
  date: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
});

const payloadSchemas = {
  venue_booking_requested: z.object({
    venueRequestId: z.string().min(1),
    venueName: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    expectedAttendance: z.number().nullable(),
    layout: z.string(),
    accessibilityRequirements: z.string(),
    requiredFacilities: z.string(),
  }),
  venue_booking_approved: z.object({
    venueRequestId: z.string().min(1),
    eventName: z.string(),
    venueName: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  }),
  venue_booking_rejected: z.object({
    venueRequestId: z.string().min(1),
    eventName: z.string(),
    venueName: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    reason: z.string(),
    suggestion: VenueSuggestionSchema.nullable(),
  }),
  venue_booking_changed: z.object({
    venueRequestId: z.string().min(1),
    eventName: z.string(),
    action: z.enum(["released", "amended"]),
    venueName: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    reason: z.string().optional(),
    previousVenueName: z.string().optional(),
    previousStartsAt: z.string().optional(),
    previousEndsAt: z.string().optional(),
  }),
  clarification_requested: z.object({
    eventName: z.string(),
    body: z.string(),
  }),
  clarification_replied: z.object({
    eventName: z.string(),
    question: z.string(),
    body: z.string(),
  }),
  event_change_requested: z.object({
    eventName: z.string(),
    whatShouldChange: z.string(),
    requestedValue: z.string(),
  }),
  handover_requested: z.object({
    eventName: z.string(),
    fromName: z.string(),
  }),
  handover_accepted: z.object({
    eventName: z.string(),
    coordinatorName: z.string(),
  }),
  handover_declined: z.object({
    eventName: z.string(),
    coordinatorName: z.string(),
  }),
  event_decided: z.object({
    eventName: z.string(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().optional(),
  }),
  event_confirmed: z.object({
    eventName: z.string(),
    venueName: z.string(),
    /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
    startsAt: z.string(),
    endsAt: z.string(),
    equipment: z.array(
      z.object({ id: z.string(), item: z.string(), quantity: z.number(), state: z.string() })
    ),
  }),
  equipment_requested: z.object({
    eventName: z.string(),
    lines: z.array(
      z.object({
        id: z.string(),
        item: z.string(),
        quantity: z.number(),
        notes: z.string().nullable(),
      })
    ),
  }),
  equipment_arrangements_completed: z.object({
    eventName: z.string(),
    lineCount: z.number(),
  }),
  equipment_unavailable: z.object({
    eventName: z.string(),
    item: z.string(),
    quantity: z.number(),
    reason: z.string(),
  }),
  equipment_released: z.object({
    eventName: z.string(),
    item: z.string(),
    requestedQuantity: z.number(),
    previousQuantity: z.number(),
    quantity: z.number(),
    arrangementStatus: z.enum(ARRANGEMENT_STATES),
    unavailableReason: z.string().nullable(),
    actorName: z.string(),
  }),
  /** PTR-45 AC7: the event information an Attendee receives when their registration succeeds. */
  event_registered: z.object({
    eventName: z.string(),
    venueName: z.string(),
    venueLocation: z.string(),
    /** Floating venue-local timestamps of the approved booking, as `event_confirmed` keeps them. */
    startsAt: z.string(),
    endsAt: z.string(),
  }),
  /**
   * PTR-45 AC8 and AC9: the registration that took the event to 90% of its place limit, or to the
   * limit itself; `registered` against `limit` says which. Every audience opens the same
   * universal event page, so `audience` only records who the notice went to.
   */
  registration_threshold_reached: z.object({
    eventName: z.string(),
    registered: z.number(),
    limit: z.number(),
    audience: z.enum(["organiser", "coordinator"]),
  }),
  /** PTR-53 AC3: the Organiser asked the assigned Coordinator to cancel the event. */
  event_cancellation_requested: z.object({ eventName: z.string() }),
  /**
   * PTR-54 AC3, AC4, AC7: the event is cancelled, told to each party in their own words. The Venue
   * Staff copy names the booking to release and not the event, as every Venue Staff notice does
   * (PTR-8 AC3). The bookings view it opens names the event, as PTR-37 AC1 requires.
   */
  event_cancelled: z.discriminatedUnion("audience", [
    z.object({
      audience: z.enum(["organiser", "attendee", "technical_support"]),
      eventName: z.string(),
    }),
    z.object({
      audience: z.literal("venue_staff"),
      venueName: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  ]),
  /** PTR-54 AC8: the Coordinator declined the Organiser's cancellation request, with a reason. */
  event_cancellation_declined: z.object({ eventName: z.string(), reason: z.string() }),
  /**
   * PTR-47 AC4: a withdrawal freed a place from an event that had been at its registration
   * capacity. `limit` is the place limit at the time; `audience` records who the notice went to.
   */
  registration_place_freed: z.object({
    eventName: z.string(),
    limit: z.number(),
    audience: z.enum(["organiser", "coordinator"]),
  }),
  registration_opened: z.object({
    eventName: z.string(),
    opensAt: z.string(),
    audience: z.enum(["organiser", "coordinator"]),
  }),
  registration_closed: z.object({
    eventName: z.string(),
    closesAt: z.string(),
    audience: z.enum(["organiser", "coordinator"]),
  }),
  /**
   * PTR-23 AC5: which significant fields changed, told to the staff holding an arrangement. The
   * Venue Staff copy names the booking and not the event, as every Venue Staff notice does
   * (PTR-8 AC3); the Technical Support copy names the event their reservation is for.
   */
  event_significant_change: z.discriminatedUnion("audience", [
    z.object({
      audience: z.literal("venue_staff"),
      venueName: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      changedFields: z.array(z.enum(SIGNIFICANT_FIELDS)).min(1),
      actorName: z.string(),
    }),
    z.object({
      audience: z.literal("technical_support"),
      eventName: z.string(),
      changedFields: z.array(z.enum(SIGNIFICANT_FIELDS)).min(1),
      actorName: z.string(),
    }),
  ]),
} satisfies Record<NotificationKind, z.ZodType>;

export type NotificationPayloads = {
  [K in NotificationKind]: z.infer<(typeof payloadSchemas)[K]>;
};

/** The stored row's kind and payload, correlated. */
export type NotificationPayload = {
  [K in NotificationKind]: { kind: K; payload: NotificationPayloads[K] };
}[NotificationKind];

/**
 * The same schemas addressed by a stored `kind`, so one parse validates a row without shaping
 * its result by hand, and an unknown kind fails closed like a malformed payload. The list is
 * explicit because Zod's discriminated-union signature needs a literal non-empty tuple; the
 * `payloadSchemas` record below is `satisfies`-checked against `NotificationKind`, so the two
 * cannot drift.
 */
const notificationPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("venue_booking_requested"),
    payload: payloadSchemas.venue_booking_requested,
  }),
  z.object({
    kind: z.literal("venue_booking_approved"),
    payload: payloadSchemas.venue_booking_approved,
  }),
  z.object({
    kind: z.literal("venue_booking_rejected"),
    payload: payloadSchemas.venue_booking_rejected,
  }),
  z.object({
    kind: z.literal("venue_booking_changed"),
    payload: payloadSchemas.venue_booking_changed,
  }),
  z.object({
    kind: z.literal("clarification_requested"),
    payload: payloadSchemas.clarification_requested,
  }),
  z.object({
    kind: z.literal("clarification_replied"),
    payload: payloadSchemas.clarification_replied,
  }),
  z.object({
    kind: z.literal("event_change_requested"),
    payload: payloadSchemas.event_change_requested,
  }),
  z.object({ kind: z.literal("handover_requested"), payload: payloadSchemas.handover_requested }),
  z.object({ kind: z.literal("handover_accepted"), payload: payloadSchemas.handover_accepted }),
  z.object({ kind: z.literal("handover_declined"), payload: payloadSchemas.handover_declined }),
  z.object({ kind: z.literal("event_decided"), payload: payloadSchemas.event_decided }),
  z.object({ kind: z.literal("event_confirmed"), payload: payloadSchemas.event_confirmed }),
  z.object({ kind: z.literal("equipment_requested"), payload: payloadSchemas.equipment_requested }),
  z.object({
    kind: z.literal("equipment_arrangements_completed"),
    payload: payloadSchemas.equipment_arrangements_completed,
  }),
  z.object({
    kind: z.literal("equipment_unavailable"),
    payload: payloadSchemas.equipment_unavailable,
  }),
  z.object({ kind: z.literal("equipment_released"), payload: payloadSchemas.equipment_released }),
  z.object({ kind: z.literal("event_registered"), payload: payloadSchemas.event_registered }),
  z.object({
    kind: z.literal("registration_threshold_reached"),
    payload: payloadSchemas.registration_threshold_reached,
  }),
  z.object({
    kind: z.literal("event_cancellation_requested"),
    payload: payloadSchemas.event_cancellation_requested,
  }),
  z.object({ kind: z.literal("event_cancelled"), payload: payloadSchemas.event_cancelled }),
  z.object({
    kind: z.literal("event_cancellation_declined"),
    payload: payloadSchemas.event_cancellation_declined,
  }),
  z.object({
    kind: z.literal("registration_place_freed"),
    payload: payloadSchemas.registration_place_freed,
  }),
  z.object({
    kind: z.literal("registration_opened"),
    payload: payloadSchemas.registration_opened,
  }),
  z.object({
    kind: z.literal("registration_closed"),
    payload: payloadSchemas.registration_closed,
  }),
  z.object({
    kind: z.literal("event_significant_change"),
    payload: payloadSchemas.event_significant_change,
  }),
]);

/**
 * Validates a persisted payload against the kind's schema. The worker treats a mismatch as a
 * terminal failure rather than retrying a row no renderer can ever read.
 */
export function parseNotificationPayload(
  kind: string,
  payload: unknown
): NotificationPayload | null {
  const parsed = notificationPayloadSchema.safeParse({ kind, payload });
  return parsed.success ? parsed.data : null;
}

/**
 * PTR-55 criterion 2: what happened, and what it concerns. One line per kind, also used as the
 * email subject. Every line names its subject; the venue-staff line names the venue only, because
 * the event name is withheld from that projection (PTR-8).
 */
export function notificationSummary(notification: NotificationPayload): string {
  switch (notification.kind) {
    case "venue_booking_requested":
      return `Venue booking requested: ${notification.payload.venueName}`;
    case "venue_booking_approved":
      return `Venue booking approved: ${notification.payload.venueName}`;
    case "venue_booking_rejected":
      return `Venue booking rejected: ${notification.payload.venueName}`;
    case "venue_booking_changed":
      return `Venue booking ${notification.payload.action}: ${notification.payload.venueName}`;
    case "clarification_requested":
      return `Clarification requested: ${notification.payload.eventName}`;
    case "clarification_replied":
      return `Clarification replied: ${notification.payload.eventName}`;
    case "event_change_requested":
      return `Event change requested: ${notification.payload.eventName}`;
    case "handover_requested":
      return `Handover requested: ${notification.payload.eventName}`;
    case "handover_accepted":
      return `Your event request has a new Coordinator: ${notification.payload.eventName}`;
    case "handover_declined":
      return `Handover declined: ${notification.payload.eventName}`;
    case "event_decided":
      return `Your event request for ${notification.payload.eventName} was ${notification.payload.decision}`;
    case "event_confirmed":
      return `Event confirmed: ${notification.payload.eventName}`;
    case "equipment_requested":
      return `Equipment request for ${notification.payload.eventName}`;
    case "equipment_arrangements_completed":
      return `Equipment arrangements complete for ${notification.payload.eventName}`;
    case "equipment_unavailable":
      return `Equipment unavailable for ${notification.payload.eventName}: ${notification.payload.item}`;
    case "equipment_released": {
      const action = notification.payload.quantity === 0 ? "released" : "reduced";
      return `Equipment ${action} for ${notification.payload.eventName}: ${notification.payload.item}`;
    }
    case "event_registered":
      return `You are registered for ${notification.payload.eventName}`;
    case "registration_threshold_reached": {
      const { eventName, registered, limit } = notification.payload;
      return `Registration is ${registered >= limit ? "full" : "nearly full"} for ${eventName}`;
    }
    case "event_cancellation_requested":
      return `Event cancellation requested: ${notification.payload.eventName}`;
    case "event_cancelled":
      return notification.payload.audience === "venue_staff"
        ? `Event cancelled: release the booking at ${notification.payload.venueName}`
        : `Event cancelled: ${notification.payload.eventName}`;
    case "event_cancellation_declined":
      return `Cancellation request declined: ${notification.payload.eventName}`;
    case "registration_place_freed":
      return `A place has been freed for ${notification.payload.eventName}`;
    case "registration_opened":
      return `Registration has opened for ${notification.payload.eventName}`;
    case "registration_closed":
      return `Registration has closed for ${notification.payload.eventName}`;
    case "event_significant_change":
      return notification.payload.audience === "venue_staff"
        ? `Event details changed for the booking at ${notification.payload.venueName}`
        : `Event details changed: ${notification.payload.eventName}`;
    default: {
      const unhandled: never = notification;
      throw new Error(`No notification summary for kind "${String(unhandled)}"`);
    }
  }
}

export interface NotificationHrefFacts {
  /** Current status of the venue request a `venue_booking_requested` row concerns. */
  venueRequestStatus?: string | null;
  /** Whether a live handover still names the recipient (checked for `handover_requested`). */
  handoverPending?: boolean;
}

/**
 * PTR-55 criterion 4: where opening the notification leads, for the surface the recipient can
 * actually read. A pending venue request links to its event page, an approved booking to the
 * bookings list, and any other venue status to nothing. The reachability check runs first; an
 * unreadable subject never gets here.
 */
export function notificationHref(
  notification: NotificationPayload & { eventRequestId: number },
  facts: NotificationHrefFacts = {}
): string | null {
  const eventRequestId = notification.eventRequestId;
  switch (notification.kind) {
    case "venue_booking_requested": {
      const status = facts.venueRequestStatus ?? null;
      // A pending request is decided on its event page, and an approved booking is listed on
      // the bookings page. Any other status (rejected, released, withdrawn, or a row that has
      // since gone) has no surface that still shows this request; the notification keeps its
      // summary and drops the link rather than pointing at a list that cannot contain it. An
      // approved booking links to /venue-bookings, which lists only upcoming bookings, so a
      // booking whose period has already started may not appear there; the notification still
      // points at the bookings surface rather than a per-booking route that does not exist.
      if (status === "pending") return `/events/${eventRequestId}`;
      if (status === "approved") return "/venue-bookings";
      return null;
    }
    case "venue_booking_approved":
    case "venue_booking_rejected":
    case "venue_booking_changed":
    case "clarification_replied":
    case "event_change_requested":
    case "handover_declined":
    case "equipment_arrangements_completed":
    case "equipment_unavailable":
    case "equipment_released":
      return `/events/${eventRequestId}`;
    case "handover_requested":
      // While the offer is live the event page refuses the not-yet-assigned Coordinator, so the
      // notification points at the coordination dashboard where accept/decline sits.
      return facts.handoverPending ? "/coordination" : `/events/${eventRequestId}`;
    case "clarification_requested":
    case "handover_accepted":
    case "event_decided":
    case "event_confirmed":
      return `/events/${eventRequestId}`;
    case "equipment_requested":
      return `/events/${eventRequestId}`;
    case "event_registered":
      return `/events/${eventRequestId}`;
    case "registration_threshold_reached":
    case "registration_place_freed":
    case "registration_opened":
    case "registration_closed":
      // Every audience opens the same universal event page now.
      return `/events/${eventRequestId}`;
    case "event_cancellation_requested":
      return `/events/${eventRequestId}`;
    case "event_cancellation_declined":
      return `/events/${eventRequestId}`;
    case "event_cancelled":
      // Each party opens the surface where they act on the cancellation (PTR-54 AC6).
      switch (notification.payload.audience) {
        case "organiser":
          return `/events/${eventRequestId}`;
        case "attendee":
          return `/events/${eventRequestId}`;
        case "venue_staff":
          // The approved bookings view (PTR-37), where Venue Staff release the booking.
          return "/venue-bookings";
        case "technical_support":
          return `/events/${eventRequestId}`;
        default: {
          const unhandled: never = notification.payload;
          throw new Error(`No event_cancelled href for "${String(unhandled)}"`);
        }
      }
    case "event_significant_change":
      // Each holder opens the surface where their arrangement is: the bookings view (PTR-37) or
      // the event page, which carries the equipment work list (PTR-39).
      return notification.payload.audience === "venue_staff"
        ? "/venue-bookings"
        : `/events/${eventRequestId}`;
    default: {
      const unhandled: never = notification;
      throw new Error(`No notification href for kind "${String(unhandled)}"`);
    }
  }
}

export interface NotificationAccessFacts {
  /** Whether the notification's event is still reachable through the caller's relationships. */
  eventAccessible: boolean;
  /** Whether a live handover on the event still names the caller. */
  handoverPending: boolean;
}

/**
 * PTR-55 criteria 1 and 5: a notification stays listed when its subject is still reachable, and
 * is neutralised when it is not. `handover_requested` reaches a Coordinator the event does not
 * connect yet, so the live offer is its own right of access. Every other kind rides the caller's
 * event relationship; the enumerated arms make a new kind state its rule rather than inherit one.
 */
export function notificationReachable(
  kind: NotificationKind,
  facts: NotificationAccessFacts
): boolean {
  switch (kind) {
    case "handover_requested":
      return facts.eventAccessible || facts.handoverPending;
    case "venue_booking_requested":
    case "venue_booking_approved":
    case "venue_booking_rejected":
    case "venue_booking_changed":
    case "clarification_requested":
    case "clarification_replied":
    case "event_change_requested":
    case "handover_accepted":
    case "handover_declined":
    case "event_decided":
    case "event_confirmed":
    case "equipment_requested":
    case "equipment_arrangements_completed":
    case "equipment_unavailable":
    case "equipment_released":
    case "event_registered":
    case "registration_threshold_reached":
    case "event_cancellation_requested":
    case "event_cancelled":
    case "event_cancellation_declined":
    case "registration_place_freed":
    case "registration_opened":
    case "registration_closed":
    case "event_significant_change":
      return facts.eventAccessible;
    default: {
      const unhandled: never = kind;
      throw new Error(`No reachability rule for notification kind "${String(unhandled)}"`);
    }
  }
}
