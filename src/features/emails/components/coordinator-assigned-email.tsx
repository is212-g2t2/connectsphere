import { Button, Section, Text } from "@react-email/components";

import { emailButton, emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface CoordinatorAssignedEmailProps {
  eventName: string;
  action: "assign" | "reassign";
  coordinatorName: string;
  previousCoordinatorName?: string;
  audience: "coordinator" | "outgoing_coordinator" | "organiser";
  /** Absent on the outgoing Coordinator's copy, which no longer reaches the event. */
  eventUrl?: string;
}

/**
 * PTR-145: one move told to each party in their own words. The incoming Coordinator and the
 * Organiser hear of every move; the outgoing Coordinator hears of a reassignment.
 */
export const CoordinatorAssignedEmail = ({
  eventName,
  action,
  coordinatorName,
  previousCoordinatorName,
  audience,
  eventUrl,
}: CoordinatorAssignedEmailProps) => {
  if (audience === "outgoing_coordinator") {
    return (
      <Layout previewText={`Event reassigned: ${eventName}`}>
        <Section>
          <Text style={emailHeading}>Event reassigned</Text>
          <Text style={emailText}>
            <strong>{eventName}</strong> no longer belongs to you.{" "}
            <strong>{coordinatorName}</strong> is now its Coordinator.
          </Text>
          {eventUrl ? (
            <Button href={eventUrl} style={emailButton}>
              View the event
            </Button>
          ) : null}
        </Section>
      </Layout>
    );
  }

  if (audience === "organiser") {
    const reassigned = action === "reassign" && previousCoordinatorName !== undefined;
    const text = reassigned
      ? `${coordinatorName} replaces ${previousCoordinatorName} as the Coordinator for`
      : `${coordinatorName} is the Coordinator for`;
    return (
      <Layout
        previewText={
          reassigned
            ? `Event Coordinator changed: ${eventName}`
            : `Event Coordinator assigned: ${eventName}`
        }
      >
        <Section>
          <Text style={emailHeading}>The event has a Coordinator</Text>
          <Text style={emailText}>
            {text} <strong>{eventName}</strong>.
          </Text>
          {eventUrl ? (
            <Button href={eventUrl} style={emailButton}>
              View the event
            </Button>
          ) : null}
        </Section>
      </Layout>
    );
  }

  return (
    <Layout previewText={`Event assigned to you: ${eventName}`}>
      <Section>
        <Text style={emailHeading}>Event assigned to you</Text>
        <Text style={emailText}>
          <strong>{eventName}</strong> is now yours to coordinate.
          {action === "reassign" && previousCoordinatorName
            ? ` It moved from ${previousCoordinatorName}.`
            : ""}
        </Text>
        {eventUrl ? (
          <Button href={eventUrl} style={emailButton}>
            View the event
          </Button>
        ) : null}
      </Section>
    </Layout>
  );
};
