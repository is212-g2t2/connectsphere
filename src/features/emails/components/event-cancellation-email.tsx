import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

/** PTR-53 AC3: the assigned Coordinator is told the Organiser asked for a cancellation. */
export const EventCancellationRequestedEmail = ({
  eventName,
  eventUrl,
}: {
  eventName: string;
  eventUrl: string;
}) => (
  <Layout previewText={`Cancellation requested for ${eventName}`}>
    <Section>
      <Text style={emailHeading}>Event cancellation requested</Text>
      <Text style={emailText}>
        The Organiser has asked for this event to be cancelled: <strong>{eventName}</strong>. Its
        status stays the same until you cancel the event or decline the request.
      </Text>
      <Button href={eventUrl} style={emailButton}>
        Review the request
      </Button>
    </Section>
  </Layout>
);
