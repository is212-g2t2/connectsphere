import { Button, Section, Text } from "@react-email/components";

import { formatDate, formatPeriod, formatTime } from "#/features/emails/format";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface HoldPeriodProps {
  venueName: string;
  /** Floating venue-local timestamps, the `mode: "string"` shape the column reads back. */
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-150 AC1: a Coordinator requested a tentative hold. Every Venue Staff member gets this email.
 * It names the venue and the period, never the event (PTR-8).
 */
export const VenueHoldRequestedEmail = (props: HoldPeriodProps & { queueUrl: string }) => (
  <Layout previewText={`Tentative hold requested: ${props.venueName}`}>
    <Section>
      <Text style={emailHeading}>Tentative hold requested</Text>
      <Text style={emailText}>
        {`A Coordinator asks to hold ${props.venueName} for ${formatPeriod(props.startsAt, props.endsAt)}. Place the hold with an expiry, or decline it.`}
      </Text>
      <Button href={props.queueUrl} style={emailButton}>
        View hold requests
      </Button>
    </Section>
  </Layout>
);

/** PTR-150 AC3: Venue Staff placed the hold request. The Coordinator learns when it expires. */
export const VenueHoldPlacedEmail = (
  props: HoldPeriodProps & { expiresAt: string; calendarUrl: string }
) => (
  <Layout previewText={`Tentative hold placed: ${props.venueName}`}>
    <Section>
      <Text style={emailHeading}>Tentative hold placed</Text>
      <Text style={emailText}>
        {`The tentative hold on ${props.venueName} for ${formatPeriod(props.startsAt, props.endsAt)} is placed. It expires on ${formatDate(props.expiresAt)}, ${formatTime(props.expiresAt)}.`}
      </Text>
      <Button href={props.calendarUrl} style={emailButton}>
        View venue calendar
      </Button>
    </Section>
  </Layout>
);

/** PTR-150 AC5: Venue Staff declined the hold request. The Coordinator gets the reason. */
export const VenueHoldDeclinedEmail = (
  props: HoldPeriodProps & { reason: string; calendarUrl: string }
) => (
  <Layout previewText={`Tentative hold request declined: ${props.venueName}`}>
    <Section>
      <Text style={emailHeading}>Tentative hold request declined</Text>
      <Text style={emailText}>
        {`The request to hold ${props.venueName} for ${formatPeriod(props.startsAt, props.endsAt)} was declined.`}
      </Text>
      <Text style={emailText}>{`Reason: ${props.reason}`}</Text>
      <Button href={props.calendarUrl} style={emailButton}>
        View venue calendar
      </Button>
    </Section>
  </Layout>
);
