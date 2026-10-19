import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatPeriod, formatTime } from "#/features/emails/format";
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
 * PTR-142 AC2, AC4: Venue Staff set or change the expiry of a tentative hold. The email tells the
 * assigned Coordinator of the event when the hold expires and when the warning occurs.
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

interface HoldNoticeProps {
  notice: "expiring" | "expired";
  venueName: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
  calendarUrl: string;
}

/** The two PTR-143 notices. The heading is also the inbox summary line and the email subject. */
const HOLD_NOTICE = {
  expiring: {
    heading: "Tentative hold expires soon",
    body: (venueName: string, period: string, expiresAt: string) =>
      `The tentative hold on ${venueName} for ${period} expires on ${when(expiresAt)}. Convert it to a booking request, or ask Venue Staff to extend it.`,
  },
  expired: {
    heading: "Tentative hold expired",
    body: (venueName: string, period: string, expiresAt: string) =>
      `The tentative hold on ${venueName} for ${period} expired on ${when(expiresAt)}, and the venue is free again. Submit a new booking request if you still need the venue.`,
  },
} as const;

/**
 * PTR-143 AC1 and AC2: the hold reached its warning time, or the sweep expired it and freed its
 * venue time. The assigned Coordinator receives either notice.
 */
export const VenueHoldNoticeEmail = ({
  notice,
  venueName,
  startsAt,
  endsAt,
  expiresAt,
  calendarUrl,
}: HoldNoticeProps) => {
  const { heading, body } = HOLD_NOTICE[notice];
  return (
    <Layout previewText={`${heading}: ${venueName}`}>
      <Section>
        <Text style={emailHeading}>{heading}</Text>
        <Text style={emailText}>{body(venueName, formatPeriod(startsAt, endsAt), expiresAt)}</Text>
        <Button href={calendarUrl} style={emailButton}>
          View venue calendar
        </Button>
      </Section>
    </Layout>
  );
};
