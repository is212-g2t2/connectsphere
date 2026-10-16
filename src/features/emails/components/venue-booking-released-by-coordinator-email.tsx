import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBookingReleasedByCoordinatorEmailProps {
  venueName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  bookingsUrl: string;
}

/**
 * PTR-137 AC4: the Coordinator released a booking that a venue block had suspended, in favour of
 * a replacement. Tells the Venue Staff member who settled it. Names the booking, never the event
 * (PTR-8).
 */
export const VenueBookingReleasedByCoordinatorEmail = ({
  venueName,
  startsAt,
  endsAt,
  reason,
  bookingsUrl,
}: VenueBookingReleasedByCoordinatorEmailProps) => (
  <Layout previewText={`Booking released at ${venueName}`}>
    <Section>
      <Text style={emailHeading}>Venue booking released by the Coordinator</Text>
      <Text style={emailText}>
        The event&apos;s Coordinator released the booking at <strong>{venueName}</strong> on{" "}
        {formatDate(startsAt)}, {formatTime(startsAt)}–{formatTime(endsAt)} while the venue was
        blocked. The lift will not restore it.
      </Text>
      <Text style={{ ...emailText, whiteSpace: "pre-line" }}>{`Reason: ${reason}`}</Text>
      <Button href={bookingsUrl} style={emailButton}>
        View venue bookings
      </Button>
    </Section>
  </Layout>
);
