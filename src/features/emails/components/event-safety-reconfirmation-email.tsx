import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

type SafetyReconfirmationReason = "out_of_date" | "rejected" | "changes_requested" | "pending";

interface EventSafetyReconfirmationEmailProps {
  eventName: string;
  reason: SafetyReconfirmationReason;
  eventRequestUrl: string;
}

const reasonText: Record<SafetyReconfirmationReason, string> = {
  out_of_date: "the arrangements changed after the safety review",
  rejected: "the safety review was rejected",
  changes_requested: "the Safety Officer requested changes",
  pending: "the safety review is still pending",
};

export const EventSafetyReconfirmationEmail = ({
  eventName,
  reason,
  eventRequestUrl,
}: EventSafetyReconfirmationEmailProps) => (
  <Layout previewText={`Safety approval needs renewal: ${eventName}`}>
    <Section>
      <Text style={emailHeading}>Safety approval needs renewal</Text>
      <Text style={emailText}>
        <strong>{eventName}</strong> is back in Planning because {reasonText[reason]}. Get a current
        safety approval, then confirm the event again.
      </Text>
      <Button href={eventRequestUrl} style={emailButton}>
        View the event
      </Button>
    </Section>
  </Layout>
);
