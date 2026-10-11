import type { ReactNode } from "react";
import { cn } from "cn";

import { LAYOUT_LABELS, parseLayouts } from "#/features/venues/schema";

/** The four operational requirements both projections carry. Nothing else. */
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
 * List the operational requirements for Venue Staff as labelled pairs. The Coordinator checks
 * them before and after sending. Drop empty terms. A wholly empty event leaves nothing to
 * restate. Show a named layout by its label. Show other text as stored.
 */
function requirementPairs(event: EventRequirementFields): Requirement[] {
  // Treat whitespace-only text as absent. A blank-looking field drops out. Keep `0`. It is a
  // real answer.
  const layout = event.layout?.trim() ?? "";
  const layouts = parseLayouts(layout).map(name => LAYOUT_LABELS[name]);
  const accessibilityRequirements = event.accessibilityRequirements?.trim();
  const requiredFacilities = event.requiredFacilities?.trim();
  const pairs: (Requirement | null)[] = [
    event.expectedAttendance === null || event.expectedAttendance === undefined
      ? null
      : { label: "Expected attendance", value: String(event.expectedAttendance) },
    layout ? { label: "Layout", value: layouts.length > 0 ? layouts.join(", ") : layout } : null,
    accessibilityRequirements ? { label: "Accessibility", value: accessibilityRequirements } : null,
    requiredFacilities ? { label: "Facilities", value: requiredFacilities } : null,
  ];
  return pairs.filter((pair): pair is Requirement => pair !== null);
}

/**
 * Check whether the requirements block would render anything. Count any requirement pair and
 * extra rows the host adds (its venue request and any rejection). Hosts skip their eyebrow when
 * the block is empty.
 */
export function hasEventRequirements(event: EventRequirementFields, hasExtra: boolean): boolean {
  return hasExtra || requirementPairs(event).length > 0;
}

/**
 * Share one requirements treatment between the request panel and the dashboard event cards. Show
 * four labelled facts from the event's fields. Show nothing when the event is bare. `className`
 * sets the host's outer spacing. `children` adds extra rows (its venue request and any
 * rejection).
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
          <dd className="mt-1 body-sm whitespace-pre-line text-foreground">{item.value}</dd>
        </div>
      ))}
      {children}
    </dl>
  );
}
