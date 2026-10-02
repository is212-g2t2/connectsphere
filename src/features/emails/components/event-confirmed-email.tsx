import { Button, Section, Text } from "@react-email/components";

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
}

export const EventConfirmedEmail = ({
  eventName,
  venueName,
  date,
  startTime,
  endTime,
  equipment,
  eventUrl,
}: EventConfirmedEmailProps) => (
  <Layout previewText={`${eventName} is confirmed`}>
    <Section>
      <Text style={emailHeading}>Your event is confirmed</Text>
      <Text style={emailText}>
        <strong>{eventName}</strong> is confirmed. The venue and technical arrangements are in
        place.
      </Text>
      <Text style={emailText}>Venue: {venueName}</Text>
      <Text style={emailText}>
        When: {date}, {startTime}–{endTime}
      </Text>
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
        View your event
      </Button>
    </Section>
  </Layout>
);
