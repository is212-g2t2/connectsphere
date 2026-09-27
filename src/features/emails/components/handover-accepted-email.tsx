import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface HandoverAcceptedEmailProps {
  eventName: string;
  coordinatorName: string;
  eventRequestUrl: string;
}

/** PTR-110 criterion 3: the Organiser learns who now handles their event. */
export const HandoverAcceptedEmail = ({
  eventName,
  coordinatorName,
  eventRequestUrl,
}: HandoverAcceptedEmailProps) => (
  <Layout previewText={`A new Coordinator for ${eventName}`}>
    <Section>
      <Text style={emailHeading}>A new Coordinator for your event</Text>
      <Text style={emailText}>
        <strong>{coordinatorName}</strong> is now the Event Coordinator for{" "}
        <strong>{eventName}</strong>.
      </Text>
      <Button href={eventRequestUrl} style={emailButton}>
        View your request
      </Button>
    </Section>
  </Layout>
);
