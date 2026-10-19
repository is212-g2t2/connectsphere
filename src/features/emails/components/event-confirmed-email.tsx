import { Button, Section, Text } from "@react-email/components";

import { formatPeriod } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventConfirmedEmailProps {
  eventName: string;
  venueName: string;
  /** Already formatted: a date, then the start and end time. */
  date: string;
  startTime: string;
  endTime: string;
  equipment: { id: string; item: string; quantity: number; state: string }[];
  eventUrl: string;
  /** PTR-137 AC6: a registered Attendee's copy names the arrangements, not "your event". */
  audience?: "organiser" | "attendee";
  /** Every approved venue and window, in booking creation order. Absent on rows stored before multi-venue. */
  venues?: { venueName: string; startsAt: string; endsAt: string }[];
}

export const EventConfirmedEmail = ({
  eventName,
  venueName,
  date,
  startTime,
  endTime,
  equipment,
  eventUrl,
  audience = "organiser",
  venues,
}: EventConfirmedEmailProps) => (
  <Layout previewText={`${eventName} is confirmed`}>
    <Section>
      <Text style={emailHeading}>
        {audience === "attendee" ? "Event arrangements confirmed" : "Your event is confirmed"}
      </Text>
      {audience === "attendee" ? (
        <Text style={emailText}>
          The arrangements for <strong>{eventName}</strong>, which you are registered for, are
          confirmed. Check the venue and time below: they may have changed since you registered.
        </Text>
      ) : (
        <Text style={emailText}>
          <strong>{eventName}</strong> is confirmed. The venue and technical arrangements are in
          place.
        </Text>
      )}
      {venues && venues.length > 1 ? (
        <>
          <Text style={emailText}>Venues:</Text>
          {venues.map(venue => (
            <Text key={`${venue.venueName}-${venue.startsAt}`} style={emailText}>
              {`${venue.venueName}: ${formatPeriod(venue.startsAt, venue.endsAt)}`}
            </Text>
          ))}
        </>
      ) : (
        <>
          <Text style={emailText}>Venue: {venueName}</Text>
          <Text style={emailText}>
            When: {date}, {startTime}–{endTime}
          </Text>
        </>
      )}
      {equipment.length > 0 && (
        <>
          <Text style={emailText}>Equipment:</Text>
          {equipment.map(line => (
            <Text key={line.id} style={emailText}>
              {line.item} × {line.quantity}: {line.state}
            </Text>
          ))}
        </>
      )}
      <Button href={eventUrl} style={emailButton}>
        {audience === "attendee" ? "View the event" : "View your event"}
      </Button>
    </Section>
  </Layout>
);
