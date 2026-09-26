import { Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBookingApprovedEmailProps {
  eventName: string;
  venueName: string;
  /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
  startsAt: string;
  endsAt: string;
}

/** PTR-33 criterion 2 (§6: a venue booking is approved): tells the raising Coordinator, naming the event. */
export const VenueBookingApprovedEmail = ({
  eventName,
  venueName,
  startsAt,
  endsAt,
}: VenueBookingApprovedEmailProps) => {
  // One string: adjacent JSX interpolations render as separate text nodes.
  const period = `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`;

  return (
    <Layout previewText={`Booking approved for ${venueName}`}>
      <Section>
        <Text style={emailHeading}>Venue booking approved</Text>
        <Text style={emailText}>
          <strong>{venueName}</strong> is booked for <strong>{eventName}</strong> on {period}.
        </Text>
      </Section>
    </Layout>
  );
};
