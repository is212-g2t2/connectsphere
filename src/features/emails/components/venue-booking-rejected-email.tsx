import { Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import type { VenueSuggestion } from "#/features/venue-requests/schema";
import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBookingRejectedEmailProps {
  eventName: string;
  venueName: string;
  /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
  startsAt: string;
  endsAt: string;
  reason: string;
  /** Whatever Venue Staff chose to suggest; null when they suggested nothing. */
  suggestion: VenueSuggestion | null;
}

/** PTR-34 criterion 4 (§6: a venue booking is rejected): tells the raising Coordinator why, and what would work. */
export const VenueBookingRejectedEmail = ({
  eventName,
  venueName,
  startsAt,
  endsAt,
  reason,
  suggestion,
}: VenueBookingRejectedEmailProps) => {
  // One string: adjacent JSX interpolations render as separate text nodes.
  const period = `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`;
  const alternative = [
    suggestion?.venueName,
    suggestion?.date && formatDate(suggestion.date),
    suggestion?.startTime && suggestion.endTime && `${suggestion.startTime}–${suggestion.endTime}`,
  ].filter(Boolean);

  return (
    <Layout previewText={`Booking rejected for ${venueName}`}>
      <Section>
        <Text style={emailHeading}>Venue booking rejected</Text>
        <Text style={emailText}>
          <strong>{venueName}</strong> cannot be booked for <strong>{eventName}</strong> on {period}
          .
        </Text>
        <Text style={emailText}>{`Reason: ${reason}`}</Text>
        {alternative.length > 0 && (
          <Text style={emailText}>{`Suggested instead: ${alternative.join(", ")}.`}</Text>
        )}
        <Text style={emailText}>Raise a new request when you are ready.</Text>
      </Section>
    </Layout>
  );
};
