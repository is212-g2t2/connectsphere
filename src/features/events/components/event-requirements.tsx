import { cn } from "cn";

import { layoutLabel } from "#/features/venues/schema";
import type { RoomLayout } from "#/features/venues/schema";

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
 * List the operational requirements for Venue Staff as labelled pairs. Drop empty terms. A wholly
 * empty event leaves nothing to restate. Show a named layout by its label. Show other text as
 * stored.
 */
function requirementPairs(
  event: EventRequirementFields,
  layouts?: readonly Pick<RoomLayout, "key" | "label">[]
): Requirement[] {
  // Treat whitespace-only text as absent. A blank-looking field drops out. Keep `0`. It is a
  // real answer.
  const layout = event.layout?.trim() ?? "";
  const accessibilityRequirements = event.accessibilityRequirements?.trim();
  const requiredFacilities = event.requiredFacilities?.trim();
  const pairs: (Requirement | null)[] = [
    event.expectedAttendance === null || event.expectedAttendance === undefined
      ? null
      : { label: "Expected attendance", value: String(event.expectedAttendance) },
    layout
      ? {
          label: "Layout",
          value: layouts ? layoutLabel(layout, layouts) : layoutLabel(layout),
        }
      : null,
    accessibilityRequirements ? { label: "Accessibility", value: accessibilityRequirements } : null,
    requiredFacilities ? { label: "Facilities", value: requiredFacilities } : null,
  ];
  return pairs.filter((pair): pair is Requirement => pair !== null);
}

/**
 * Check whether the host's requirements block would render anything. Count any requirement pair
 * and the extra blocks the host shows beside it (its venue requests). Hosts skip their eyebrow
 * when the block is empty.
 */
export function hasEventRequirements(
  event: EventRequirementFields,
  hasExtra: boolean,
  layouts?: readonly Pick<RoomLayout, "key" | "label">[]
): boolean {
  return hasExtra || requirementPairs(event, layouts).length > 0;
}

/**
 * Share one requirements treatment between the event page's venue section and the Venue Staff
 * request details. Show four labelled facts from the given fields. Show nothing when they are all
 * blank. `className` sets the host's outer spacing.
 */
export function EventRequirements({
  event,
  layouts,
  className,
}: {
  event: EventRequirementFields;
  /** The maintained list. Absent callers show the six initials. */
  layouts?: readonly Pick<RoomLayout, "key" | "label">[];
  className?: string;
}) {
  const items = requirementPairs(event, layouts);
  if (items.length === 0) return null;

  return (
    <dl className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {items.map(item => (
        <div key={item.label}>
          <dt className="eyebrow text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 body-sm whitespace-pre-line text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
