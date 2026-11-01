import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

/** PTR-53 AC3: the assigned Coordinator is told the Organiser asked for a cancellation. */
export const EventCancellationRequestedEmail = ({
  eventName,
  eventUrl,
  audience,
}: {
  eventName: string;
  eventUrl: string;
  /** PTR-144: Leads get the queue link and wait for assignment. Absent on the coordinator copy. */
  audience?: "lead";
}) => {
  const lead = audience === "lead";
  return (
    <Layout previewText={`Cancellation requested for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Event cancellation requested</Text>
        <Text style={emailText}>
          The Organiser has asked for this event to be cancelled: <strong>{eventName}</strong>.
          {lead
            ? " No Coordinator is assigned yet, so the request waits for assignment."
            : " Its status stays the same until you cancel the event or decline the request."}
        </Text>
        <Button href={eventUrl} style={emailButton}>
          {lead ? "View the queue" : "Review the request"}
        </Button>
      </Section>
    </Layout>
  );
};

type EventCancelledEmailProps = { eventUrl: string; reason?: string } & (
  | { audience: "organiser" | "attendee" | "technical_support"; eventName: string }
  | { audience: "venue_staff"; venueName: string; startsAt: string; endsAt: string }
);

/**
 * PTR-54 AC3, AC4, AC7: the event is cancelled. Staff are told what they still hold, because
 * nothing is released for them (AC6). The Venue Staff copy names the booking and not the event, as
 * every Venue Staff notice does (PTR-8 AC3); the bookings view it links to names the event, as
 * PTR-37 AC1 requires. PTR-164 AC1, AC5: the Organiser's and each Attendee's copy shows the
 * reason; the staff copies show none.
 */
export const EventCancelledEmail = (props: EventCancelledEmailProps) => {
  if (props.audience === "venue_staff") {
    const { venueName, startsAt, endsAt, eventUrl } = props;
    return (
      <Layout previewText={`Booking to release at ${venueName}`}>
        <Section>
          <Text style={emailHeading}>Event cancelled</Text>
          <Text style={emailText}>
            The event booked at <strong>{venueName}</strong> on {formatDate(startsAt)},{" "}
            {formatTime(startsAt)}–{formatTime(endsAt)} has been cancelled. The booking is still
            held: release it when you are ready.
          </Text>
          <Button href={eventUrl} style={emailButton}>
            View venue bookings
          </Button>
        </Section>
      </Layout>
    );
  }

  const { audience, eventName, eventUrl, reason } = props;
  return (
    <Layout previewText={`${eventName} has been cancelled`}>
      <Section>
        <Text style={emailHeading}>Event cancelled</Text>
        <Text style={emailText}>
          <strong>{eventName}</strong> has been cancelled.
          {audience === "technical_support"
            ? " Its equipment reservations are still held: release them when you are ready."
            : ""}
        </Text>
        {(audience === "organiser" || audience === "attendee") && reason ? (
          <Text style={{ ...emailText, whiteSpace: "pre-line" }}>Reason: {reason}</Text>
        ) : null}
        <Button href={eventUrl} style={emailButton}>
          {audience === "organiser" ? "View your request" : "View the event"}
        </Button>
      </Section>
    </Layout>
  );
};

/** PTR-54 AC8: the Organiser is told their cancellation request was declined, and why. */
export const EventCancellationDeclinedEmail = ({
  eventName,
  reason,
  eventUrl,
  closeOut,
  eventStatus,
}: {
  eventName: string;
  reason: string;
  eventUrl: string;
  /** PTR-156: true when completion closed the request instead of a Coordinator declining it. */
  closeOut?: boolean;
  /** PTR-156: the event status at decline time. A declined cancellation on a rejected event stays rejected. */
  eventStatus?: string;
}) => {
  const closed = closeOut === true;
  return (
    <Layout previewText={`Cancellation request ${closed ? "closed" : "declined"} for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Cancellation request {closed ? "closed" : "declined"}</Text>
        <Text style={emailText}>
          Your request to cancel <strong>{eventName}</strong>{" "}
          {closed ? "was closed. " : "was declined. "}
          {closed
            ? "The event has already taken place, so this request was closed."
            : eventStatus === "rejected"
              ? "The event stays rejected."
              : "The event goes ahead."}
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>Reason: {reason}</Text>
        <Button href={eventUrl} style={emailButton}>
          View your request
        </Button>
      </Section>
    </Layout>
  );
};
