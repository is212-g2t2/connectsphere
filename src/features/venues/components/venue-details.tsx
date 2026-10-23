import { WEEKDAY_LABELS, WEEKDAYS, layoutLabelForKey } from "#/features/venues/schema";
import type { RoomLayout, VenueValues } from "#/features/venues/schema";

/**
 * Render a venue record read-only for roles that can view but not edit it (PTR-26 criterion 4).
 * Show the same data as the form in a description list.
 */
export function VenueDetails({
  venue,
  layouts,
}: {
  venue: Omit<VenueValues, "id">;
  /** The maintained list, from the route loader. A rename shows here under the new label. */
  layouts: readonly RoomLayout[];
}) {
  return (
    <dl className="grid gap-6 sm:grid-cols-2">
      <Detail term="Location">{venue.location}</Detail>
      <Detail term="Maximum capacity">{venue.maxCapacity}</Detail>
      <Detail term="Setup time">{venue.setupMinutes} minutes</Detail>
      <Detail term="Turnaround time">{venue.turnaroundMinutes} minutes</Detail>
      <Detail term="Facilities">{listOrNone(venue.facilities)}</Detail>
      <Detail term="Accessibility features">{listOrNone(venue.accessibilityFeatures)}</Detail>
      <Detail term="Supported room layouts">
        {listOrNone(venue.supportedLayouts.map(key => layoutLabelForKey(key, layouts)))}
      </Detail>
      <div className="sm:col-span-2">
        <dt className="eyebrow text-muted-foreground">Operating hours</dt>
        <dd className="mt-2">
          <ul className="space-y-1">
            {WEEKDAYS.map(day => {
              const range = venue.operatingHours[day];
              return (
                <li key={day} className="flex items-baseline gap-3 body-sm">
                  <span className="w-20 shrink-0 font-medium">{WEEKDAY_LABELS[day]}</span>
                  <span>{range ? `${range.opens} – ${range.closes}` : "Closed"}</span>
                </li>
              );
            })}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{term}</dt>
      <dd className="mt-2 body-md font-medium">{children}</dd>
    </div>
  );
}

function listOrNone(values: string[]): string {
  return values.join(", ") || "None recorded";
}
