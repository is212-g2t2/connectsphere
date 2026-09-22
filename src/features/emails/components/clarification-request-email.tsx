import { Button, Section, Text } from "@react-email/components";
import { Layout } from "./layout";
import { emailButton, emailHeading, emailText } from "./email-styles";

interface ClarificationRequestEmailProps {
  /** The event name shown in the subject area. */
  eventName: string;
  /** The clarification text the Coordinator wrote. */
  body: string;
  /** Deep-link to the organiser's event request detail page. */
  eventRequestUrl: string;
}

/**
 * PTR-19 criterion 3: sent to the Organiser when the assigned Coordinator raises a
 * clarification request (§6: additional information or amendment is requested).
 */
export const ClarificationRequestEmail = ({
  eventName,
  body,
  eventRequestUrl,
}: ClarificationRequestEmailProps) => {
  return (
    <Layout previewText={`Clarification requested for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Clarification requested</Text>
        <Text style={emailText}>
          Your Event Coordinator has a question about your event request{" "}
          <strong>{eventName}</strong> and needs your input before planning can continue.
        </Text>
        <Text style={{ ...emailText, fontStyle: "italic" }}>{body}</Text>
        <Button href={eventRequestUrl} style={emailButton}>
          View your request
        </Button>
      </Section>
    </Layout>
  );
};
