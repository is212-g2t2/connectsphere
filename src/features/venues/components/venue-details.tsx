import { WEEKDAYS } from "#/features/venues/schema";
import type { VenueValues } from "#/features/venues/schema";
import { LAYOUT_LABELS, WEEKDAY_LABELS } from "#/features/venues/components/venue-form";

/**
 * The read-only rendering of a venue record for roles that may view but not edit it
 * (PTR-26 criterion 4). Same data as the form, laid out as a description list.
 */
export function VenueDetails({ venue }: { venue: Omit<VenueValues, "id"> }) {
  return (
    <dl className="grid gap-6 sm:grid-cols-2">
      <Detail term="Location">{venue.location}</Detail>
      <Detail term="Maximum capacity">{venue.maxCapacity}</Detail>
      <Detail term="Facilities">{listOrNone(venue.facilities)}</Detail>
      <Detail term="Accessibility features">{listOrNone(venue.accessibilityFeatures)}</Detail>
      <Detail term="Supported room layouts">
        {listOrNone(venue.supportedLayouts.map(layout => LAYOUT_LABELS[layout]))}
      </Detail>
      <div className="sm:col-span-2">
        <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
          Operating hours
        </dt>
        <dd className="mt-2">
          <ul className="grid gap-1 sm:grid-cols-2">
            {WEEKDAYS.map(day => {
              const range = venue.operatingHours[day];
              return (
                <li key={day} className="flex justify-between gap-4 text-sm">
                  <span>{WEEKDAY_LABELS[day]}</span>
                  <span className="font-medium">
                    {range ? `${range.opens} – ${range.closes}` : "Closed"}
                  </span>
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
      <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{term}</dt>
      <dd className="mt-2 text-sm font-medium">{children}</dd>
    </div>
  );
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None recorded";
}
