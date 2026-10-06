import type { eventRequests } from "#/db/schema";
import { clarificationAmendmentKeys } from "#/features/event-requests/schema";
import type {
  ClarificationAmendment,
  ClarificationAmendmentValue,
  ClarificationField,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";

/**
 * JSON with object keys in a fixed order. `jsonb` reorders keys when it stores them, so a plain
 * `JSON.stringify` of the locked row and of the freshly parsed values can differ on key order
 * alone; sorting here compares the values, not how Postgres laid them out. An explicit `undefined`
 * becomes `null`, matching how an absent value returns from the row; a missing key stays missing.
 */
function normalisedForComparison(value: unknown): ClarificationAmendmentValue {
  if (Array.isArray(value)) return value.map(normalisedForComparison);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]): [string, ClarificationAmendmentValue] => [
          key,
          normalisedForComparison(entry),
        ])
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalisedForComparison(left)) === JSON.stringify(normalisedForComparison(right))
  );
}

/**
 * What `values` changes on the locked row, for the given fields only. A field left identical
 * produces no entry, so a client that re-sends every value cannot pad the history.
 * `attendeeRegistration` is one entry covering its four columns. A clarification reply (PTR-19)
 * passes the fields its question permits; an event information update (PTR-22) passes them all.
 */
export function amendmentsBetween(
  request: typeof eventRequests.$inferSelect,
  values: EventRequestDraftValues,
  fields: readonly ClarificationField[]
): ClarificationAmendment[] {
  const amendments: ClarificationAmendment[] = [];
  const seen = new Set<ClarificationField>();

  for (const field of fields) {
    if (seen.has(field)) continue;
    seen.add(field);

    if (field === "attendeeRegistration") {
      const from = {
        registrationEnabled: request.registrationEnabled,
        registrationCapacity: request.registrationCapacity,
        registrationOpensAt: request.registrationOpensAt,
        registrationClosesAt: request.registrationClosesAt,
      };
      const to = {
        registrationEnabled: values.registrationEnabled,
        registrationCapacity: values.registrationCapacity,
        registrationOpensAt: values.registrationOpensAt,
        registrationClosesAt: values.registrationClosesAt,
      };
      if (!sameValue(from, to)) {
        amendments.push({
          field,
          from: normalisedForComparison(from),
          to: normalisedForComparison(to),
        });
      }
      continue;
    }
    // A field this build no longer knows about maps to no column, so it cannot differ.
    if (!clarificationAmendmentKeys(field).includes(field)) continue;
    const from = request[field];
    const to = values[field];
    if (!sameValue(from, to)) {
      amendments.push({
        field,
        from: normalisedForComparison(from),
        to: normalisedForComparison(to),
      });
    }
  }

  return amendments;
}
