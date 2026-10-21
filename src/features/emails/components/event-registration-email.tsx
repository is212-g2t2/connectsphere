import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatPeriod, formatTime } from "#/features/emails/format";
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
  /** Every approved venue and window, in booking creation order. Absent on rows stored before multi-venue. */
  venues?: { venueName: string; venueLocation: string; startsAt: string; endsAt: string }[];
}

/** PTR-45 AC7: the Attendee's registration is recorded, with the event information. */
export const EventRegisteredEmail = ({
  eventName,
  venueName,
  venueLocation,
  startsAt,
  endsAt,
  eventUrl,
  venues,
}: EventRegisteredEmailProps) => {
  // One string per line, not several interpolations: adjacent JSX interpolations are separated
  // by markup comments in the rendered HTML. A booking that ends on a later day names both days.
  const period = formatPeriod(startsAt, endsAt);
  const venue = venueLocation ? `${venueName}, ${venueLocation}` : venueName;

  return (
    <Layout previewText={`You are registered for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>You are registered</Text>
        <Text style={emailText}>
          Your place at <strong>{eventName}</strong> is recorded.
        </Text>
        {venues && venues.length > 1 ? (
          <>
            {venues.map(entry => {
              const entryPeriod = formatPeriod(entry.startsAt, entry.endsAt);
              const entryVenue = entry.venueLocation
                ? `${entry.venueName}, ${entry.venueLocation}`
                : entry.venueName;
              return (
                <Text
                  key={`${entry.venueName}-${entry.startsAt}`}
                  style={emailText}
                >{`When: ${entryPeriod}; Venue: ${entryVenue}`}</Text>
              );
            })}
          </>
        ) : (
          <>
            <Text style={emailText}>{`When: ${period}`}</Text>
            <Text style={emailText}>{`Venue: ${venue}`}</Text>
          </>
        )}
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
  /** The place limit: the lower of the registration capacity and the venue places VIPs leave. */
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

interface RegistrationPlaceFreedEmailProps {
  eventName: string;
  /** The place limit after the withdrawal. */
  limit: number;
  eventUrl: string;
}

/**
 * PTR-47 AC4: a place was freed from an event that had been at its registration capacity.
 * Sent to the Organiser and the assigned Coordinator so they know the event can accept one
 * more Attendee.
 */
export const RegistrationPlaceFreedEmail = ({
  eventName,
  limit,
  eventUrl,
}: RegistrationPlaceFreedEmailProps) => (
  <Layout previewText={`A place has been freed for ${eventName}`}>
    <Section>
      <Text style={emailHeading}>A place has been freed</Text>
      <Text style={emailText}>
        An Attendee has withdrawn from <strong>{eventName}</strong>. The event now has one more
        place free (limit: {limit}).
      </Text>
      <Button href={eventUrl} style={emailButton}>
        View the event
      </Button>
    </Section>
  </Layout>
);

interface RegistrationWindowEmailProps {
  eventName: string;
  boundary: "opened" | "closed";
  time: string;
  eventUrl: string;
}

/** PTR-49: the registration window opened or closed for an event. */
export const RegistrationWindowEmail = ({
  eventName,
  boundary,
  time,
  eventUrl,
}: RegistrationWindowEmailProps) => {
  const isOpened = boundary === "opened";
  const heading = isOpened ? "Registration has opened" : "Registration has closed";
  // Non-breaking spaces keep the date whole at narrow widths.
  const period = `${formatDate(time).replaceAll(" ", "\u00A0")} at ${formatTime(time)}`;

  return (
    <Layout previewText={`${heading} for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>{heading}</Text>
        <Text style={emailText}>
          <strong>{eventName}'s</strong>
          {` registration ${isOpened ? "opened" : "closed"} on ${period}.`}
        </Text>
        <Button href={eventUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
};

interface RegistrationPlaceAvailableEmailProps {
  eventName: string;
  eventUrl: string;
}

/**
 * A place opened at a full event with a waiting list. Places stay first come, first served:
 * the notice reserves nothing.
 */
export const RegistrationPlaceAvailableEmail = ({
  eventName,
  eventUrl,
}: RegistrationPlaceAvailableEmailProps) => (
  <Layout previewText={`A place is available for ${eventName}`}>
    <Section>
      <Text style={emailHeading}>A place is available</Text>
      <Text style={emailText}>
        A place has opened for <strong>{eventName}</strong>. Places go first come, first served, so
        register soon.
      </Text>
      <Button href={eventUrl} style={emailButton}>
        View the event
      </Button>
    </Section>
  </Layout>
);
