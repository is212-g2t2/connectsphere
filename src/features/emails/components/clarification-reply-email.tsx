import { Button, Section, Text } from "@react-email/components";
import { Layout } from "./layout";
import { emailButton, emailHeading, emailText } from "./email-styles";

export function ClarificationReplyEmail({
  eventName,
  question,
  body,
  eventRequestUrl,
}: {
  eventName: string;
  question: string;
  body: string;
  eventRequestUrl: string;
}) {
  return (
    <Layout previewText={`Clarification replied for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Clarification replied</Text>
        <Text style={emailText}>
          The Organiser has replied about <strong>{eventName}</strong>. The request is ready for
          review.
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>Question</strong>
          {"\n"}
          {question}
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>Reply</strong>
          {"\n"}
          {body}
        </Text>
        <Button href={eventRequestUrl} style={emailButton}>
          Review the request
        </Button>
      </Section>
    </Layout>
  );
}
