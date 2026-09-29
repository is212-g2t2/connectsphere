import { z } from "zod";

import {
  EQUIPMENT_QUANTITY_MESSAGE,
  EQUIPMENT_TYPE_MAX_LENGTH,
  EQUIPMENT_TYPE_MESSAGE,
} from "#/features/event-requests/schema";

/**
 * Pure data and Zod only: routes and the form import this module, so per AGENTS.md nothing here
 * may reach `#/db/schema` or any other server-only dependency.
 */

export const EQUIPMENT_NOTES_MAX = 2000;
export const EQUIPMENT_NOTES_MESSAGE = `Notes must be ${EQUIPMENT_NOTES_MAX} characters or fewer`;
export const EQUIPMENT_NO_LINES_MESSAGE =
  "No equipment lines recorded. Add at least one line before submitting.";

// Shared id shape: text primary key, same rule as `VenueRequestIdInput`.
const EquipmentRequestId = z
  .string({ error: "Choose an equipment line" })
  .trim()
  .min(1, "Choose an equipment line")
  .max(64, "Choose an equipment line");

/**
 * PTR-38 AC1/AC4: add or edit one equipment line. All three required fields must be present on
 * save — the draft leniency of the organiser's form (partial lines while typing) does not apply
 * here; the Coordinator is editing a committed record.
 */
export const EquipmentLineInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  /** Present on edit, absent on add. */
  id: EquipmentRequestId.optional(),
  item: z
    .string()
    .trim()
    .min(1, "Enter an equipment type")
    .max(EQUIPMENT_TYPE_MAX_LENGTH, EQUIPMENT_TYPE_MESSAGE),
  quantity: z
    .number({ error: EQUIPMENT_QUANTITY_MESSAGE })
    .int(EQUIPMENT_QUANTITY_MESSAGE)
    .positive(EQUIPMENT_QUANTITY_MESSAGE)
    .max(2_147_483_647, "Equipment quantity is larger than this record can store"),
  notes: z.string().max(EQUIPMENT_NOTES_MAX, EQUIPMENT_NOTES_MESSAGE).optional(),
});

export type EquipmentLineValues = z.infer<typeof EquipmentLineInput>;

export function parseEquipmentLineInput(data: unknown): EquipmentLineValues {
  const parsed = EquipmentLineInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** PTR-38 AC4: remove one line. */
export const RemoveEquipmentLineInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  id: EquipmentRequestId,
});

export type RemoveEquipmentLineValues = z.infer<typeof RemoveEquipmentLineInput>;

export function parseRemoveEquipmentLineInput(data: unknown): RemoveEquipmentLineValues {
  const parsed = RemoveEquipmentLineInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

/** PTR-38 AC5: submit the full set to Technical Support. Only the event id is needed. */
export const SubmitEquipmentInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
});

export type SubmitEquipmentValues = z.infer<typeof SubmitEquipmentInput>;

export function parseSubmitEquipmentInput(data: unknown): SubmitEquipmentValues {
  const parsed = SubmitEquipmentInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

// ── Form shapes (string-leaf values for React inputs) ─────────────────────────────────────────

/**
 * The shape a React form holds: every leaf is a string, because that is what `<input>` gives back.
 * Parsing the form shape converts strings into the wire type and pipes into `EquipmentLineInput`.
 */
export const EquipmentLineFormShape = z.object({
  item: z.string(),
  quantity: z.string(),
  notes: z.string(),
});

export type EquipmentLineFormValues = z.infer<typeof EquipmentLineFormShape>;

function parseWholeNumber(value: string) {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * Form validator: the same gate the server uses, so every field is checked once and each message
 * marks its own input. `eventId` and `id` are injected by the caller before the server call, not
 * part of the form shape.
 */
export const EquipmentLineFormInput = EquipmentLineFormShape.transform(
  (values): { item: string; quantity: number; notes?: string | undefined } => ({
    item: values.item,
    quantity: values.quantity === "" ? Number.NaN : parseWholeNumber(values.quantity),
    notes: values.notes === "" ? undefined : values.notes,
  })
).pipe(EquipmentLineInput.omit({ eventId: true, id: true }));
