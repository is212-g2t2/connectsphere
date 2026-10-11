import type { EquipmentReleaseRecord } from "#/features/equipment-requests/schema";

// Format in UTC. Server and client then render the same calendar day.
const releaseDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** Show the most recent reduce/release on a line. Keep it after the reservation row is gone. */
export function LastReleaseNote({
  release,
}: {
  release?: EquipmentReleaseRecord | null | undefined;
}) {
  if (!release) return null;
  const unit = release.quantity === 1 ? "unit" : "units";
  return (
    <p className="caption text-muted-foreground">
      {`Last release: ${release.quantity} ${unit} given back by ${release.byName} on ${releaseDateFormatter.format(new Date(release.at))}.`}
    </p>
  );
}
