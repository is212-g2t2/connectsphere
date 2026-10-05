import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EventChangeRequestEmailProps {
  eventName: string;
  whatShouldChange: string;
  requestedValue: string;
  eventRequestUrl: string;
}

export const EventChangeRequestEmail = ({
  eventName,
  whatShouldChange,
  requestedValue,
  eventRequestUrl,
}: EventChangeRequestEmailProps) => {
  return (
    <Layout previewText={`Change requested for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Event change requested</Text>
        <Text style={emailText}>
          The Organiser has requested a change to <strong>{eventName}</strong>.
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>What should change</strong>
          {"\n"}
          {whatShouldChange}
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>Requested new value</strong>
          {"\n"}
          {requestedValue}
        </Text>
        <Button href={eventRequestUrl} style={emailButton}>
          Review the request
        </Button>
      </Section>
    </Layout>
  );
};
