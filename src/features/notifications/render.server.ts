import { createElement } from "react";
import type { ReactElement } from "react";

import { env } from "#/env";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { formatDate, formatTime } from "#/features/emails/format";
import {
  EquipmentArrangementsCompleteEmail,
  EquipmentUnavailableEmail,
} from "#/features/emails/components/equipment-arrangements-email";
import { EquipmentReleasedEmail } from "#/features/emails/components/equipment-released-email";
import { EquipmentRequestEmail } from "#/features/emails/components/equipment-request-email";
import {
  EventCancellationDeclinedEmail,
  EventCancellationRequestedEmail,
  EventCancelledEmail,
} from "#/features/emails/components/event-cancellation-email";
import { EventChangeRequestEmail } from "#/features/emails/components/event-change-request-email";
import { EventConfirmedEmail } from "#/features/emails/components/event-confirmed-email";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import {
  EventRegisteredEmail,
  RegistrationPlaceFreedEmail,
  RegistrationThresholdEmail,
  RegistrationWindowEmail,
} from "#/features/emails/components/event-registration-email";
import { HandoverAcceptedEmail } from "#/features/emails/components/handover-accepted-email";
import { HandoverDeclinedEmail } from "#/features/emails/components/handover-declined-email";
import { HandoverRequestEmail } from "#/features/emails/components/handover-request-email";
import { VenueBookingApprovedEmail } from "#/features/emails/components/venue-booking-approved-email";
import { VenueBookingChangedEmail } from "#/features/emails/components/venue-booking-changed-email";
import { VenueBookingRejectedEmail } from "#/features/emails/components/venue-booking-rejected-email";
import { VenueBookingRequestEmail } from "#/features/emails/components/venue-booking-request-email";
import { notificationHref, notificationSummary } from "#/features/notifications/message";
import type { NotificationPayload } from "#/features/notifications/message";

export interface RenderedNotification {
  subject: string;
  element: ReactElement;
}

/**
 * Maps a stored notification to the email the worker sends. Templates are rendered at send time,
 * so a queued row always uses the current template, and the subject is the same summary line the
 * inbox shows (PTR-55 AC2). Absolute links are built here from `BETTER_AUTH_URL` at delivery
 * time, which keeps URLs out of the payload.
 */
export function renderNotificationEmail(
  notification: NotificationPayload & { eventRequestId: number }
): RenderedNotification {
  const base = env.BETTER_AUTH_URL.replace(/\/+$/u, "");
  const eventRequestId = notification.eventRequestId;
  const subject = notificationSummary(notification);

  switch (notification.kind) {
    case "venue_booking_requested": {
      const { venueName, startsAt, endsAt, expectedAttendance, layout } = notification.payload;
      const { accessibilityRequirements, requiredFacilities } = notification.payload;
      return {
        subject,
        element: createElement(VenueBookingRequestEmail, {
          venueName,
          startsAt,
          endsAt,
          expectedAttendance,
          layout,
          accessibilityRequirements,
          requiredFacilities,
        }),
      };
    }
    case "venue_booking_approved": {
      const { eventName, venueName, startsAt, endsAt } = notification.payload;
      return {
        subject,
        element: createElement(VenueBookingApprovedEmail, {
          eventName,
          venueName,
          startsAt,
          endsAt,
        }),
      };
    }
    case "venue_booking_rejected": {
      const { eventName, venueName, startsAt, endsAt, reason, suggestion } = notification.payload;
      return {
        subject,
        element: createElement(VenueBookingRejectedEmail, {
          eventName,
          venueName,
          startsAt,
          endsAt,
          reason,
          suggestion,
        }),
      };
    }
    case "venue_booking_changed": {
      const { eventName, action, venueName, startsAt, endsAt } = notification.payload;
      const { reason, previousVenueName, previousStartsAt, previousEndsAt } = notification.payload;
      return {
        subject,
        element: createElement(VenueBookingChangedEmail, {
          eventName,
          action,
          venueName,
          startsAt,
          endsAt,
          reason,
          previousVenueName,
          previousStartsAt,
          previousEndsAt,
        }),
      };
    }
    case "clarification_requested": {
      const { eventName, body } = notification.payload;
      return {
        subject,
        element: createElement(ClarificationRequestEmail, {
          eventName,
          body,
          eventRequestUrl: `${base}/event-requests/${eventRequestId}`,
        }),
      };
    }
    case "clarification_replied": {
      const { eventName, question, body } = notification.payload;
      return {
        subject,
        element: createElement(ClarificationReplyEmail, {
          eventName,
          question,
          body,
          eventRequestUrl: `${base}/coordination/${eventRequestId}`,
        }),
      };
    }
    case "event_change_requested": {
      const { eventName, whatShouldChange, requestedValue } = notification.payload;
      return {
        subject,
        element: createElement(EventChangeRequestEmail, {
          eventName,
          whatShouldChange,
          requestedValue,
          eventRequestUrl: `${base}/coordination/${eventRequestId}`,
        }),
      };
    }
    case "handover_requested": {
      const { eventName, fromName } = notification.payload;
      return {
        subject,
        element: createElement(HandoverRequestEmail, {
          eventName,
          fromName,
          coordinationUrl: `${base}/coordination`,
        }),
      };
    }
    case "handover_accepted": {
      const { eventName, coordinatorName } = notification.payload;
      return {
        subject,
        element: createElement(HandoverAcceptedEmail, {
          eventName,
          coordinatorName,
          eventRequestUrl: `${base}/event-requests/${eventRequestId}`,
        }),
      };
    }
    case "handover_declined": {
      const { eventName, coordinatorName } = notification.payload;
      return {
        subject,
        element: createElement(HandoverDeclinedEmail, {
          eventName,
          coordinatorName,
          eventRequestUrl: `${base}/coordination/${eventRequestId}`,
        }),
      };
    }
    case "event_decided": {
      const { eventName, decision, reason } = notification.payload;
      return {
        subject,
        element: createElement(EventDecisionEmail, {
          eventName,
          decision,
          reason,
          eventRequestUrl: `${base}/event-requests/${eventRequestId}`,
        }),
      };
    }
    case "event_confirmed": {
      const { eventName, venueName, startsAt, endsAt, equipment } = notification.payload;
      return {
        subject,
        element: createElement(EventConfirmedEmail, {
          eventName,
          venueName,
          date: formatDate(startsAt),
          startTime: formatTime(startsAt),
          endTime: formatTime(endsAt),
          equipment,
          eventUrl: `${base}/event-requests/${eventRequestId}`,
        }),
      };
    }
    case "equipment_requested": {
      const { lines } = notification.payload;
      return {
        subject,
        element: createElement(EquipmentRequestEmail, { eventId: eventRequestId, lines }),
      };
    }
    case "equipment_arrangements_completed": {
      const { lineCount } = notification.payload;
      return {
        subject,
        element: createElement(EquipmentArrangementsCompleteEmail, {
          eventId: eventRequestId,
          lineCount,
        }),
      };
    }
    case "equipment_unavailable": {
      const { item, quantity, reason } = notification.payload;
      return {
        subject,
        element: createElement(EquipmentUnavailableEmail, {
          eventId: eventRequestId,
          item,
          quantity,
          reason,
        }),
      };
    }
    case "equipment_released": {
      const { item, requestedQuantity, previousQuantity, quantity } = notification.payload;
      const { arrangementStatus, unavailableReason, actorName } = notification.payload;
      return {
        subject,
        element: createElement(EquipmentReleasedEmail, {
          eventName: notification.payload.eventName,
          item,
          requestedQuantity,
          previousQuantity,
          quantity,
          arrangementStatus,
          unavailableReason,
          actorName,
        }),
      };
    }
    case "event_registered": {
      const { eventName, venueName, venueLocation, startsAt, endsAt } = notification.payload;
      return {
        subject,
        element: createElement(EventRegisteredEmail, {
          eventName,
          venueName,
          venueLocation,
          startsAt,
          endsAt,
          eventUrl: `${base}/events/${eventRequestId}`,
        }),
      };
    }
    case "registration_threshold_reached": {
      const { eventName, registered, limit, audience } = notification.payload;
      const path = audience === "coordinator" ? "coordination" : "event-requests";
      return {
        subject,
        element: createElement(RegistrationThresholdEmail, {
          eventName,
          registered,
          limit,
          eventUrl: `${base}/${path}/${eventRequestId}`,
        }),
      };
    }
    case "registration_opened":
    case "registration_closed": {
      const isOpened = notification.kind === "registration_opened";
      return {
        subject,
        element: createElement(RegistrationWindowEmail, {
          eventName: notification.payload.eventName,
          boundary: isOpened ? "opened" : "closed",
          time: isOpened ? notification.payload.opensAt : notification.payload.closesAt,
          eventUrl: `${base}${notificationHref(notification) ?? ""}`,
        }),
      };
    }
    case "event_cancellation_requested":
      return {
        subject,
        element: createElement(EventCancellationRequestedEmail, {
          eventName: notification.payload.eventName,
          eventUrl: `${base}/coordination/${eventRequestId}`,
        }),
      };
    case "event_cancelled":
      // The link is the surface each party acts on, the same one the inbox opens.
      return {
        subject,
        element: createElement(EventCancelledEmail, {
          ...notification.payload,
          eventUrl: `${base}${notificationHref(notification) ?? ""}`,
        }),
      };
    case "event_cancellation_declined":
      return {
        subject,
        element: createElement(EventCancellationDeclinedEmail, {
          eventName: notification.payload.eventName,
          reason: notification.payload.reason,
          eventUrl: `${base}/event-requests/${eventRequestId}`,
        }),
      };
    case "registration_place_freed": {
      const { eventName, limit } = notification.payload;
      return {
        subject,
        element: createElement(RegistrationPlaceFreedEmail, {
          eventName,
          limit,
          eventUrl: `${base}${notificationHref(notification) ?? ""}`,
        }),
      };
    }
    default: {
      const unhandled: never = notification;
      throw new Error(`No email template for notification kind "${String(unhandled)}"`);
    }
  }
}
