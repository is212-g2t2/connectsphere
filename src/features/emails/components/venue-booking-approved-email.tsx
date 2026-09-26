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

/**
 * PTR-33 criterion 2: sent to the Coordinator who raised the request when Venue Staff approve it
 * (§6: a venue booking is approved). Unlike the staff-facing request email it names the event,
 * since the recipient is the Coordinator the event is assigned to.
 */
export const VenueBookingApprovedEmail = ({
  eventName,
  venueName,
  startsAt,
  endsAt,
}: VenueBookingApprovedEmailProps) => {
  // One string, not three interpolations: adjacent JSX interpolations are separated by markup
  // comments, which splits the window across text nodes in the rendered HTML.
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
