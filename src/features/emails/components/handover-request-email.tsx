import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface HandoverRequestEmailProps {
  eventName: string;
  fromName: string;
  coordinationUrl: string;
}

/** PTR-110 criterion 1: the incoming Coordinator is asked to take an event over. */
export const HandoverRequestEmail = ({
  eventName,
  fromName,
  coordinationUrl,
}: HandoverRequestEmailProps) => (
  <Layout previewText={`Handover requested: ${eventName}`}>
    <Section>
      <Text style={emailHeading}>Handover requested</Text>
      <Text style={emailText}>
        {fromName} would like you to take over <strong>{eventName}</strong> as its Event
        Coordinator. Accept or decline the handover from your coordination page.
      </Text>
      <Button href={coordinationUrl} style={emailButton}>
        Review the handover
      </Button>
    </Section>
  </Layout>
);
