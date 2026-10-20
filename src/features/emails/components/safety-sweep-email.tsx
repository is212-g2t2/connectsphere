import { Button, Section, Text } from "@react-email/components";
import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

export function SafetySweepEmail({ eventName, eventUrl }: { eventName: string; eventUrl: string }) {
  const heading = "Safety review requested";
  return (
    <Layout previewText={`${heading}: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>{heading}</Text>
        <Text style={emailText}>
          <strong>{eventName}</strong> has complete venue and technical arrangements and awaits your
          safety review.
        </Text>
        <Button href={eventUrl} style={emailButton}>
          View the event
        </Button>
      </Section>
    </Layout>
  );
}
