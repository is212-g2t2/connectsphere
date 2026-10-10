import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { significantFieldPhrase } from "#/features/event-requests/schema";
import type { SignificantField } from "#/features/event-requests/schema";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

type EventSignificantChangeEmailProps = {
  changedFields: readonly SignificantField[];
  actorName: string;
  arrangementUrl: string;
} & (
  | { audience: "technical_support"; eventName: string }
  | { audience: "venue_staff"; venueName: string; startsAt: string; endsAt: string }
);

/**
 * PTR-23 AC5: the Coordinator saved a significant change on an event whose arrangement the
 * recipient holds. Nothing is released or re-statused by the change (AC3); the recipient checks
 * that what they hold still suits the event. The Venue Staff copy names the booking and not the event,
 * as every Venue Staff notice does (PTR-8 AC3).
 */
export const EventSignificantChangeEmail = (props: EventSignificantChangeEmailProps) => {
  const { changedFields, actorName, arrangementUrl } = props;
  const changed = significantFieldPhrase(changedFields);

  if (props.audience === "venue_staff") {
    const { venueName, startsAt, endsAt } = props;
    return (
      <Layout previewText={`Event details changed for the booking at ${venueName}`}>
        <Section>
          <Text style={emailHeading}>Event details changed</Text>
          <Text style={emailText}>
            {actorName} changed the {changed} of the event booked at <strong>{venueName}</strong> on{" "}
            {formatDate(startsAt)}, {formatTime(startsAt)}–{formatTime(endsAt)}.
          </Text>
          <Text style={emailText}>
            The booking is unchanged and still held. Check that it still suits the event, and talk
            to the Coordinator if it does not.
          </Text>
          <Button href={arrangementUrl} style={emailButton}>
            View venue bookings
          </Button>
        </Section>
      </Layout>
    );
  }

  const { eventName } = props;
  return (
    <Layout previewText={`Event details changed: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Event details changed</Text>
        <Text style={emailText}>
          {actorName} changed the {changed} of <strong>{eventName}</strong>.
        </Text>
        <Text style={emailText}>
          Its equipment reservations are unchanged and still held. Check that they still suit the
          event, and talk to the Coordinator if they do not.
        </Text>
        <Button href={arrangementUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
};
