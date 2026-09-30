import { Section, Text } from "@react-email/components";

import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface EquipmentReleasedEmailProps {
  eventName: string;
  item: string;
  requestedQuantity: number;
  previousQuantity: number;
  quantity: number;
  arrangementStatus: string;
  unavailableReason: string | null;
  actorName: string;
}

/**
 * PTR-42 criterion 3: tells the assigned Coordinator that Technical Support reduced or released
 * a reservation on their event, what the line now holds against what was asked, and the state the
 * line went back to. The event's status is untouched; the Coordinator decides what to do next.
 */
export const EquipmentReleasedEmail = ({
  eventName,
  item,
  requestedQuantity,
  previousQuantity,
  quantity,
  arrangementStatus,
  unavailableReason,
  actorName,
}: EquipmentReleasedEmailProps) => {
  const action = quantity === 0 ? "released" : "reduced";
  return (
    <Layout previewText={`Equipment ${action} for ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Equipment reservation {action}</Text>
        <Text style={emailText}>
          {actorName} {action} the reservation of {item} for {eventName}.
        </Text>
        <Text style={emailText}>
          Held before: {previousQuantity}. Held now: {quantity}. Requested: {requestedQuantity}.
        </Text>
        <Text style={emailText}>
          The line is now {arrangementStateLabel(arrangementStatus)}
          {unavailableReason ? `: ${unavailableReason}` : ""}.
        </Text>
        <Text style={emailText}>
          The event&apos;s status has not changed. Talk to the Organiser if the arrangements need to
          change.
        </Text>
      </Section>
    </Layout>
  );
};
