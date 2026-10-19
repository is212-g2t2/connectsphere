import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface HandoverRequestEmailProps {
  eventName: string;
  fromName: string;
  eventRequestUrl: string;
}

/**
 * PTR-110 criterion 1, retired by PTR-145. A notification queued before the retirement still
 * renders: it names the event and points at the event record, where the current Coordinator is.
 */
export const HandoverRequestEmail = ({
  eventName,
  fromName,
  eventRequestUrl,
}: HandoverRequestEmailProps) => (
  <Layout previewText={`Handover requested: ${eventName}`}>
    <Section>
      <Text style={emailHeading}>Handover requested</Text>
      <Text style={emailText}>
        {fromName} offered <strong>{eventName}</strong> to you. Handovers are no longer accepted or
        declined; the Lead now moves the assignment.
      </Text>
      <Button href={eventRequestUrl} style={emailButton}>
        View the event
      </Button>
    </Section>
  </Layout>
);
