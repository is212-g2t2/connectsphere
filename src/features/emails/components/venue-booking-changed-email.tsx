import { Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBookingChangedEmailProps {
  eventName: string;
  action: "released" | "amended";
  venueName: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
  previousVenueName?: string;
  previousStartsAt?: string;
  previousEndsAt?: string;
}

/** PTR-37 AC4: tells the assigned Coordinator when an approved booking changes. */
export const VenueBookingChangedEmail = ({
  eventName,
  action,
  venueName,
  startsAt,
  endsAt,
  reason,
  previousVenueName,
  previousStartsAt,
  previousEndsAt,
}: VenueBookingChangedEmailProps) => {
  const period = `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`;
  const previousPeriod =
    previousStartsAt && previousEndsAt
      ? `${previousVenueName ?? "Previous venue"}, ${formatDate(previousStartsAt)}, ${formatTime(previousStartsAt)}–${formatTime(previousEndsAt)}`
      : null;

  return (
    <Layout previewText={`Booking ${action} for ${venueName}`}>
      <Section>
        <Text style={emailHeading}>Venue booking {action}</Text>
        <Text style={emailText}>
          The booking for <strong>{eventName}</strong> is {action}.
        </Text>
        {action === "released" ? (
          <Text style={emailText}>
            <strong>{venueName}</strong> is available again for {period}.
          </Text>
        ) : (
          <Text style={emailText}>
            The new booking is <strong>{venueName}</strong> on {period}.
            {previousPeriod ? ` It was ${previousPeriod}.` : ""}
          </Text>
        )}
        {reason ? <Text style={emailText}>{`Reason: ${reason}`}</Text> : null}
      </Section>
    </Layout>
  );
};
