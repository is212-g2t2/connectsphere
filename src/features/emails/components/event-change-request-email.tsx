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

type EventChangeProcessedEmailProps = {
  eventName: string;
  whatShouldChange: string;
  eventRequestUrl: string;
} & ({ outcome: "applied" } | { outcome: "declined"; reason: string });

/**
 * PTR-52 AC5: the Organiser is told what the Coordinator did with their change request. An applied
 * request sends them to the record, which now shows the new values; a declined one carries the
 * Coordinator's reason.
 */
export const EventChangeProcessedEmail = (props: EventChangeProcessedEmailProps) => {
  const { eventName, whatShouldChange, eventRequestUrl } = props;
  return (
    <Layout previewText={`Change request ${props.outcome} for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Change request {props.outcome}</Text>
        <Text style={emailText}>
          Your request to change <strong>{eventName}</strong> was {props.outcome}.
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>What should change</strong>
          {"\n"}
          {whatShouldChange}
        </Text>
        {props.outcome === "declined" ? (
          <Text style={{ ...emailText, whiteSpace: "pre-line" }}>Reason: {props.reason}</Text>
        ) : (
          <Text style={emailText}>The event record now shows the new information.</Text>
        )}
        <Button href={eventRequestUrl} style={emailButton}>
          View your request
        </Button>
      </Section>
    </Layout>
  );
};
