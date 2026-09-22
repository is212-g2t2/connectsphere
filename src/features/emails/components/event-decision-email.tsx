import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventDecisionEmailProps {
  eventName: string;
  decision: "approved" | "rejected";
  reason?: string;
  eventRequestUrl: string;
}

export const EventDecisionEmail = ({
  eventName,
  decision,
  reason,
  eventRequestUrl,
}: EventDecisionEmailProps) => (
  <Layout previewText={`Your event request was ${decision}`}>
    <Section>
      <Text style={emailHeading}>Event request {decision}</Text>
      <Text style={emailText}>
        Your request for <strong>{eventName}</strong> was {decision}.
      </Text>
      {reason && <Text style={emailText}>Reason: {reason}</Text>}
      <Button href={eventRequestUrl} style={emailButton}>
        View your request
      </Button>
    </Section>
  </Layout>
);
