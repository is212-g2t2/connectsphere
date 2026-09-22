import { Section, Text } from "@react-email/components";

import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventDecisionEmailProps {
  eventName: string;
  decision: "approved" | "rejected";
  reason?: string;
}

export const EventDecisionEmail = ({ eventName, decision, reason }: EventDecisionEmailProps) => (
  <Layout previewText={`Your event request was ${decision}`}>
    <Section>
      <Text style={emailHeading}>Event request {decision}</Text>
      <Text style={emailText}>
        Your request for <strong>{eventName}</strong> was {decision}.
      </Text>
      {reason && <Text style={emailText}>Reason: {reason}</Text>}
      <Text style={emailText}>Open ConnectSphere to view the recorded decision.</Text>
    </Section>
  </Layout>
);
