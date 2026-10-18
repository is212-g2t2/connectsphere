import { Button, Section, Text } from "@react-email/components";

import { formatPeriod } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBufferConflictEmailProps {
  eventName: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
  setupMinutes: number;
  turnaroundMinutes: number;
  periods?: { startsAt: string; endsAt: string }[];
  calendarUrl: string;
}

/** Tells the Coordinator that a venue buffer change created a conflict for their event's arrangement. */
export const VenueBufferConflictEmail = ({
  eventName,
  venueName,
  startsAt,
  endsAt,
  setupMinutes,
  turnaroundMinutes,
  periods,
  calendarUrl,
}: VenueBufferConflictEmailProps) => {
  const period = (periods ?? [{ startsAt, endsAt }])
    .map(p => formatPeriod(p.startsAt, p.endsAt))
    .join("; ");

  return (
    <Layout previewText={`Venue buffer conflict: ${venueName}`}>
      <Section>
        <Text style={emailHeading}>Venue buffer conflict</Text>
        <Text style={emailText}>
          {`A change to the buffer times for `}
          <strong>{venueName}</strong>
          {` created a scheduling conflict with `}
          <strong>{eventName}</strong>
          {` (${period}).`}
        </Text>
        <Text style={emailText}>
          {`The venue now requires ${setupMinutes} minutes of setup time and ${turnaroundMinutes} minutes of turnaround time.`}
        </Text>
        <Text style={emailText}>
          Please review the event arrangements to resolve this conflict.
        </Text>
        <Button href={calendarUrl} style={emailButton}>
          View venue calendar
        </Button>
      </Section>
    </Layout>
  );
};
