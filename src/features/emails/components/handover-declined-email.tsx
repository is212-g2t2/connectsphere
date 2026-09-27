import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface HandoverDeclinedEmailProps {
  eventName: string;
  coordinatorName: string;
  eventRequestUrl: string;
}

/** PTR-110 criterion 4: the outgoing Coordinator learns the offer was turned down. */
export const HandoverDeclinedEmail = ({
  eventName,
  coordinatorName,
  eventRequestUrl,
}: HandoverDeclinedEmailProps) => (
  <Layout previewText={`Handover declined: ${eventName}`}>
    <Section>
      <Text style={emailHeading}>Handover declined</Text>
      <Text style={emailText}>
        <strong>{coordinatorName}</strong> declined the handover of <strong>{eventName}</strong>.
        You remain its Event Coordinator.
      </Text>
      <Button href={eventRequestUrl} style={emailButton}>
        View the request
      </Button>
    </Section>
  </Layout>
);
