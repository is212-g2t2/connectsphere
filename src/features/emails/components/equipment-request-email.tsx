import { Section, Text } from "@react-email/components";

import { Layout } from "./layout";
import { emailHeading, emailText } from "./email-styles";
import type { EquipmentLine } from "#/features/equipment-requests/schema";

interface EquipmentRequestEmailProps {
  eventId: number;
  lines: EquipmentLine[];
}

/**
 * PTR-38 AC5: sent to every Technical Support Staff member when a Coordinator submits the
 * equipment list. Names each item and quantity; notes appear when present. The event is
 * identified by id only — Technical Support Staff see the event through their own relationship,
 * not by name, matching the nameless projection PTR-8 established for Venue Staff.
 */
export const EquipmentRequestEmail = ({ eventId, lines }: EquipmentRequestEmailProps) => (
  <Layout previewText={`Equipment request for event ${eventId}`}>
    <Section>
      <Text style={emailHeading}>Equipment request submitted</Text>
      <Text style={emailText}>
        A Coordinator has submitted an equipment request for event {eventId}.
      </Text>
      {lines.map(line => (
        <Text key={line.id} style={emailText}>
          {line.item} × {line.quantity}
          {line.notes ? ` — ${line.notes}` : ""}
        </Text>
      ))}
      <Text style={emailText}>It is waiting in the equipment work list.</Text>
    </Section>
  </Layout>
);
