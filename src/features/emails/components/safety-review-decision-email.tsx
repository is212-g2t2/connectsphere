import { Button, Section, Text } from "@react-email/components";

import { safetyReviewDecisionLabel } from "#/features/safety-reviews/schema";
import type { SafetyReviewDecision } from "#/features/safety-reviews/schema";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface SafetyReviewDecisionEmailProps {
  eventName: string;
  decision: SafetyReviewDecision;
  comments: string;
  eventRequestUrl: string;
}

/**
 * PTR-146 AC4: the Safety Officer's decision, sent to the event's Coordinator with the tracking
 * comments.
 */
export const SafetyReviewDecisionEmail = ({
  eventName,
  decision,
  comments,
  eventRequestUrl,
}: SafetyReviewDecisionEmailProps) => {
  const label = safetyReviewDecisionLabel(decision);
  return (
    <Layout previewText={`Safety review ${label}: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Safety review {label}</Text>
        <Text style={emailText}>
          The operational-safety review of <strong>{eventName}</strong> was {label}.
        </Text>
        {comments ? <Text style={emailText}>Comments: {comments}</Text> : null}
        <Button href={eventRequestUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
};
