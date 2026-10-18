import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventSubmittedEmailProps {
  eventName: string;
  audience: "organiser" | "lead";
  eventUrl: string;
}

/** PTR-144: the Organiser's copy confirms the record; the Lead copy waits for assignment. */
export const EventSubmittedEmail = ({
  eventName,
  audience,
  eventUrl,
}: EventSubmittedEmailProps) => {
  if (audience === "lead") {
    return (
      <Layout previewText={`New event request: ${eventName}`}>
        <Section>
          <Text style={emailHeading}>New event request</Text>
          <Text style={emailText}>
            <strong>{eventName}</strong> waits for a Coordinator to be assigned.
          </Text>
          <Button href={eventUrl} style={emailButton}>
            View the queue
          </Button>
        </Section>
      </Layout>
    );
  }

  return (
    <Layout previewText={`Event request submitted: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Event request submitted</Text>
        <Text style={emailText}>
          Your request for <strong>{eventName}</strong> is recorded.
        </Text>
        <Button href={eventUrl} style={emailButton}>
          View your request
        </Button>
      </Section>
    </Layout>
  );
};
