import { Button, Section, Text } from "@react-email/components";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

export function SafetySweepEmail({
  eventName,
  requested,
  eventUrl,
}: {
  eventName: string;
  requested: boolean;
  eventUrl: string;
}) {
  const heading = requested ? "Safety review requested" : "Safety approval required again";
  return (
    <Layout previewText={`${heading}: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>{heading}</Text>
        <Text style={emailText}>
          <strong>{eventName}</strong>
          {requested
            ? " has complete venue and technical arrangements and awaits your safety review."
            : " has returned to planning because its safety approval is no longer current. Review the arrangements before confirming it again."}
        </Text>
        <Button href={eventUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
}
