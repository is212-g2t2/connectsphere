import { Section, Text } from "@react-email/components";

import { Layout } from "./layout";
import { emailHeading, emailText } from "./email-styles";

interface EquipmentArrangementsCompleteEmailProps {
  eventId: number;
  lineCount: number;
}

/**
 * PTR-42 AC1: sent to the assigned Coordinator when Technical Support Staff marks
 * technical arrangements complete.
 */
export const EquipmentArrangementsCompleteEmail = ({
  eventId,
  lineCount,
}: EquipmentArrangementsCompleteEmailProps) => (
  <Layout previewText={`Technical arrangements complete for event ${eventId}`}>
    <Section>
      <Text style={emailHeading}>Technical arrangements complete</Text>
      <Text style={emailText}>
        Technical Support Staff have marked equipment arrangements complete for event {eventId}.
      </Text>
      <Text style={emailText}>
        All {lineCount} requested equipment {lineCount === 1 ? "line has" : "lines have"} been
        reserved or marked not required.
      </Text>
    </Section>
  </Layout>
);

interface EquipmentUnavailableEmailProps {
  eventId: number;
  item: string;
  quantity: number;
  reason: string;
}

/**
 * PTR-42 AC2: sent to the assigned Coordinator when Technical Support Staff records
 * that requested equipment cannot be provided.
 */
export const EquipmentUnavailableEmail = ({
  eventId,
  item,
  quantity,
  reason,
}: EquipmentUnavailableEmailProps) => (
  <Layout previewText={`Equipment unavailable for event ${eventId}`}>
    <Section>
      <Text style={emailHeading}>Requested equipment unavailable</Text>
      <Text style={emailText}>
        Technical Support Staff reported that requested equipment cannot be provided for event{" "}
        {eventId}.
      </Text>
      <Text style={emailText}>
        <strong>Item:</strong> {item} × {quantity}
      </Text>
      <Text style={emailText}>
        <strong>Reason:</strong> {reason}
      </Text>
    </Section>
  </Layout>
);
