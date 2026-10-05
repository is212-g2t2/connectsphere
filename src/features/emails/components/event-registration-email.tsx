import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventRegisteredEmailProps {
  eventName: string;
  venueName: string;
  venueLocation: string;
  /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
  startsAt: string;
  endsAt: string;
  eventUrl: string;
}

/** PTR-45 AC7: the Attendee's registration is recorded, with the event information. */
export const EventRegisteredEmail = ({
  eventName,
  venueName,
  venueLocation,
  startsAt,
  endsAt,
  eventUrl,
}: EventRegisteredEmailProps) => {
  // One string per line, not several interpolations: adjacent JSX interpolations are separated
  // by markup comments in the rendered HTML. A booking that ends on a later day names both days.
  const sameDay = startsAt.slice(0, 10) === endsAt.slice(0, 10);
  const period = sameDay
    ? `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`
    : `${formatDate(startsAt)}, ${formatTime(startsAt)} – ${formatDate(endsAt)}, ${formatTime(endsAt)}`;
  const venue = venueLocation ? `${venueName}, ${venueLocation}` : venueName;

  return (
    <Layout previewText={`You are registered for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>You are registered</Text>
        <Text style={emailText}>
          Your place at <strong>{eventName}</strong> is recorded.
        </Text>
        <Text style={emailText}>{`When: ${period}`}</Text>
        <Text style={emailText}>{`Venue: ${venue}`}</Text>
        <Button href={eventUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
};

interface RegistrationThresholdEmailProps {
  eventName: string;
  registered: number;
  /** The place limit: the lower of the registration capacity and the venue capacity. */
  limit: number;
  eventUrl: string;
}

/**
 * PTR-45 AC8 (§6: registration reaches capacity) and AC9 (90% of it): tells the Organiser and the
 * Coordinator how many places are taken.
 */
export const RegistrationThresholdEmail = ({
  eventName,
  registered,
  limit,
  eventUrl,
}: RegistrationThresholdEmailProps) => {
  const full = registered >= limit;
  const heading = full ? "Registration is full" : "Registration is nearly full";
  const detail = full ? " Attendees can no longer register." : "";

  return (
    <Layout previewText={`${heading} for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>{heading}</Text>
        <Text style={emailText}>
          <strong>{eventName}</strong>
          {`: ${registered} of ${limit} places are taken.${detail}`}
        </Text>
        <Button href={eventUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
};
