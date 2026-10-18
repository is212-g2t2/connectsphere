import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueHoldExpiryEmailProps {
  action: "set" | "extended" | "shortened";
  venueName: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  previousExpiresAt: string | null;
  warnAt: string | null;
  calendarUrl: string;
}

const ACTION_HEADING = {
  set: "Expiry set on your tentative hold",
  extended: "Expiry extended on your tentative hold",
  shortened: "Expiry shortened on your tentative hold",
} as const;

const when = (value: string) => `${formatDate(value)}, ${formatTime(value)}`;

/**
 * PTR-142 AC2, AC4: Venue Staff set or changed the expiry of a tentative hold. Tells the event's
 * assigned Coordinator when the hold now expires and when the warning fires.
 */
export const VenueHoldExpiryEmail = ({
  action,
  venueName,
  startsAt,
  endsAt,
  expiresAt,
  previousExpiresAt,
  warnAt,
  calendarUrl,
}: VenueHoldExpiryEmailProps) => (
  <Layout previewText={`${ACTION_HEADING[action]}: ${venueName}`}>
    <Section>
      <Text style={emailHeading}>{ACTION_HEADING[action]}</Text>
      <Text style={emailText}>
        {`Your tentative hold on ${venueName} for ${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)} now expires on ${when(expiresAt)}.`}
      </Text>
      {previousExpiresAt === null ? null : (
        <Text style={emailText}>{`The previous expiry was ${when(previousExpiresAt)}.`}</Text>
      )}
      <Text style={emailText}>
        {warnAt === null
          ? "You have not set a warning time for this hold."
          : `Your warning time stays at ${when(warnAt)}.`}
      </Text>
      <Button href={calendarUrl} style={emailButton}>
        View venue calendar
      </Button>
    </Section>
  </Layout>
);
