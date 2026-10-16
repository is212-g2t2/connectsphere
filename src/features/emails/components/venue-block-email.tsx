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
}

/** Tells the Coordinator that a venue block changed for their event. */
export const VenueBlockEmail = ({
  action,
  eventName,
  venueName,
  startsAt,
  endsAt,
  reason,
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
        {action === "blocked" ? (
          <Text style={emailText}>
            <strong>{venueName}</strong> is unavailable {period} for <strong>{eventName}</strong>.
          </Text>
        ) : (
          <Text style={emailText}>
            <strong>{venueName}</strong> is available again {period} for{" "}
            <strong>{eventName}</strong>.
          </Text>
        )}
        <Text style={emailText}>{`Reason: ${reason}`}</Text>
      </Section>
    </Layout>
  );
};
