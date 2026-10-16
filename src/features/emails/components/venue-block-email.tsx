import { Section, Text } from "@react-email/components";

import { formatDate, formatTime } from "#/features/emails/format";
import { emailHeading, emailText } from "./email-styles";
import { Layout } from "./layout";

interface VenueBlockEmailProps {
  action: "blocked" | "lifted";
  eventName: string;
  venueName: string;
  startsAt: string;
  endsAt: string | null;
  reason: string;
  /** PTR-137 AC2: the block took this confirmed event back to planning. */
  revertedToPlanning?: boolean;
  /** PTR-137 AC4: the lift restored the arrangement of an event still in planning. */
  restoredToPlanning?: boolean;
}

/** Tells the Coordinator that a venue block changed for their event. */
export const VenueBlockEmail = ({
  action,
  eventName,
  venueName,
  startsAt,
  endsAt,
  reason,
  revertedToPlanning = false,
  restoredToPlanning = false,
}: VenueBlockEmailProps) => {
  // React puts a markup comment between adjacent JSX interpolations. Build the period and the
  // reason line as one string each, so their text has no comment inside. A block that ends on a
  // later day names both days, as `EventRegisteredEmail` does.
  const sameDay = endsAt !== null && startsAt.slice(0, 10) === endsAt.slice(0, 10);
  const period =
    endsAt === null
      ? action === "blocked"
        ? `from ${formatDate(startsAt)}, ${formatTime(startsAt)} until lifted`
        : `from ${formatDate(startsAt)}, ${formatTime(startsAt)}`
      : sameDay
        ? `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`
        : `${formatDate(startsAt)}, ${formatTime(startsAt)} – ${formatDate(endsAt)}, ${formatTime(endsAt)}`;

  return (
    <Layout
      previewText={
        action === "blocked" ? `Venue blocked: ${venueName}` : `Venue available again: ${venueName}`
      }
    >
      <Section>
        <Text style={emailHeading}>
          {action === "blocked" ? "Venue blocked" : "Venue available again"}
        </Text>
        <Text style={emailText}>
          <strong>{venueName}</strong>
          {action === "blocked"
            ? ` is unavailable ${period} for `
            : ` is available again ${period} for `}
          <strong>{eventName}</strong>.
        </Text>
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>{`Reason: ${reason}`}</Text>
        {action === "blocked" && revertedToPlanning && (
          <Text style={emailText}>
            The event is back in planning. Its booking is still recorded but reserves nothing while
            the block stands. Arrange a replacement venue or wait for the block to be lifted, then
            confirm the event again.
          </Text>
        )}
        {action === "lifted" && restoredToPlanning && (
          <Text style={emailText}>
            Venue Staff restored the arrangement and the event waits in planning. Confirm the event
            once its arrangements are in place.
          </Text>
        )}
      </Section>
    </Layout>
  );
};
