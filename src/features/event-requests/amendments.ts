import type { eventRequests } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import {
  clarificationAmendmentKeys,
  LISTED_DETAIL_FIELDS,
  missingFieldsMessage,
  missingRequiredFields,
  parseDraftInput,
} from "#/features/event-requests/schema";
import type {
  ClarificationAmendment,
  ClarificationAmendmentValue,
  ClarificationField,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";

/**
 * Return JSON with object keys in a fixed order. `jsonb` can reorder keys, so plain
 * `JSON.stringify` can report a change when only the key order differs. Sort keys to compare
 * values, not Postgres's storage order. Convert explicit `undefined` values to `null`, as row reads
 * do. Keep missing keys absent.
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
 * Return changes to the locked row for the given fields. Do not add an entry when a field stays the
 * same, so resending values does not pad the history. `attendeeRegistration` is one entry for its
 * four columns. A clarification reply (PTR-19) passes allowed fields; an event update (PTR-22)
 * passes all fields.
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

/**
 * Return one amendment for each field in `fields` that the user changed. Omit fields left at their
 * loaded values, so an older form cannot revert a later change. `attendeeRegistration` spans four
 * columns, so a change to any one sends all four as a group.
 */
export function pickAmendments(
  values: EventRequestDraftValues,
  fields: readonly ClarificationField[],
  changedFields: readonly string[]
): Record<string, unknown> {
  const changed = new Set(changedFields);
  const amendments: Record<string, unknown> = {};

  for (const field of fields) {
    const keys = clarificationAmendmentKeys(field);
    if (!keys.some(key => changed.has(key))) continue;

    if (field === "attendeeRegistration") {
      amendments.registrationEnabled = values.registrationEnabled;
      amendments.registrationCapacity = values.registrationCapacity ?? null;
      amendments.registrationOpensAt = values.registrationOpensAt ?? null;
      amendments.registrationClosesAt = values.registrationClosesAt ?? null;
      continue;
    }

    amendments[field] = values[field] ?? null;
  }

  return amendments;
}

/**
 * Apply `amendments` to the locked row, then parse the result with the draft rules. The schema
 * treats stored `null` values as absent. Submitted events need complete fields, so a missing field
 * throws its named error.
 */
export function amendedValues(
  request: typeof eventRequests.$inferSelect,
  amendments: Record<string, unknown>
): EventRequestDraftValues {
  const merged = { ...request, ...amendments };
  const { id: _id, ...values } = parseDraftInput({
    ...merged,
    expectedAttendance: merged.expectedAttendance ?? undefined,
    registrationCapacity: merged.registrationCapacity ?? undefined,
    registrationOpensAt: merged.registrationOpensAt ?? undefined,
    registrationClosesAt: merged.registrationClosesAt ?? undefined,
  });
  const missing = missingRequiredFields(values);
  // PTR-155 applies to submission, not to a reply or an update. Check a listed detail only when
  // this amendment clears it, so a row created before the rule can still be completed.
  for (const [key, label] of LISTED_DETAIL_FIELDS) {
    if (key in amendments && values[key].trim() === "") missing.push(label);
  }
  // A status-carrying refusal, so `withSession` answers 409 instead of a 500.
  if (missing.length > 0) throw new ConflictError(missingFieldsMessage(missing));
  return values;
}
