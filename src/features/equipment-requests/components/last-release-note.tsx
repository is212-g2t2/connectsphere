import type { EquipmentReleaseRecord } from "#/features/equipment-requests/schema";

// Formatted in UTC so server and client render the same calendar day.
const releaseDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** The most recent reduce/release on a line, kept after the reservation row is gone. */
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
