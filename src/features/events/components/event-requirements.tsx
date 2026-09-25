import type { ReactNode } from "react";
import { cn } from "cn";

import { LAYOUT_LABELS, parseLayouts } from "#/features/venues/schema";

/** The four operational requirements both projections carry, and nothing else. */
interface EventRequirementFields {
  expectedAttendance?: number | null;
  layout?: string | null;
  accessibilityRequirements?: string | null;
  requiredFacilities?: string | null;
}

interface Requirement {
  label: string;
  value: string;
}

/**
 * The operational requirements Venue Staff receive, as labelled pairs the Coordinator can check
 * before and after sending. Empty terms drop out, a wholly empty event leaves nothing to restate,
 * and a free-text layout reads back as the layout it names rather than the raw stored words.
 */
function requirementPairs(event: EventRequirementFields): Requirement[] {
  const layouts = parseLayouts(event.layout ?? "").map(layout => LAYOUT_LABELS[layout]);
  const pairs: (Requirement | null)[] = [
    event.expectedAttendance === null || event.expectedAttendance === undefined
      ? null
      : { label: "Expected attendance", value: String(event.expectedAttendance) },
    event.layout
      ? { label: "Layout", value: layouts.length > 0 ? layouts.join(", ") : event.layout }
      : null,
    event.accessibilityRequirements
      ? { label: "Accessibility", value: event.accessibilityRequirements }
      : null,
    event.requiredFacilities ? { label: "Facilities", value: event.requiredFacilities } : null,
  ];
  return pairs.filter((pair): pair is Requirement => pair !== null);
}

/**
 * The one requirements treatment the request panel and the dashboard's event cards share: four
 * labelled facts from the event's fields, and nothing when the event is bare. `className` is the
 * host's outer spacing, and `children` is the one extra row a card adds (its pending request).
 */
export function EventRequirements({
  event,
  className,
  children,
}: {
  event: EventRequirementFields;
  className?: string;
  children?: ReactNode;
}) {
  const items = requirementPairs(event);
  if (items.length === 0 && !children) return null;

  return (
    <dl className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {items.map(item => (
        <div key={item.label}>
          <dt className="eyebrow text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 font-medium whitespace-pre-line text-foreground">{item.value}</dd>
        </div>
      ))}
      {children}
    </dl>
  );
}
