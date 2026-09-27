import { Section, Text } from "@react-email/components";
import { formatDate, formatTime } from "#/features/emails/format";
import { Layout } from "./layout";
import { emailHeading, emailText } from "./email-styles";

interface VenueBookingRequestEmailProps {
  venueName: string;
  /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
  startsAt: string;
  endsAt: string;
  expectedAttendance: number | null;
  /** The event's operational requirements; an empty string renders no line. */
  layout: string;
  accessibilityRequirements: string;
  requiredFacilities: string;
}

/**
 * PTR-31 criterion 4: sent to every Venue Staff member when a Coordinator raises a booking
 * request (§6: a venue booking is requested). It names the venue and the requested window, and
 * carries criterion 2's requirements — expected attendance, layout, accessibility and required
 * facilities — one line each, present only when the event states one. It deliberately does not
 * name the event: the venue-staff projection withholds it (PTR-8), so the notification must not
 * leak what the event page will not show.
 */
export const VenueBookingRequestEmail = ({
  venueName,
  startsAt,
  endsAt,
  expectedAttendance,
  layout,
  accessibilityRequirements,
  requiredFacilities,
}: VenueBookingRequestEmailProps) => {
  // One string, not three interpolations: adjacent JSX interpolations are separated by markup
  // comments, which splits the window across text nodes in the rendered HTML.
  const window = `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`;

  return (
    <Layout previewText={`Booking requested for ${venueName}`}>
      <Section>
        <Text style={emailHeading}>Venue booking requested</Text>
        <Text style={emailText}>
          A Coordinator has requested <strong>{venueName}</strong> for {window}.
        </Text>
        {expectedAttendance !== null && (
          <Text style={emailText}>{`Expected attendance: ${expectedAttendance}.`}</Text>
        )}
        {layout.trim() !== "" && <Text style={emailText}>{`Layout: ${layout}.`}</Text>}
        {accessibilityRequirements.trim() !== "" && (
          <Text style={emailText}>
            {`Accessibility requirements: ${accessibilityRequirements}.`}
          </Text>
        )}
        {requiredFacilities.trim() !== "" && (
          <Text style={emailText}>{`Required facilities: ${requiredFacilities}.`}</Text>
        )}
        <Text style={emailText}>It is waiting in the pending booking requests.</Text>
      </Section>
    </Layout>
  );
};
