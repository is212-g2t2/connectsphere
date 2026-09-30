import { z } from "zod";

import {
  EQUIPMENT_QUANTITY_MESSAGE,
  EQUIPMENT_TYPE_MAX_LENGTH,
  EQUIPMENT_TYPE_MESSAGE,
  parseWholeNumber,
  PositiveWholeNumber,
} from "#/features/event-requests/schema";

/**
 * Pure data and Zod only: routes and the form import this module, so per AGENTS.md nothing here
 * may reach `#/db/schema` or any other server-only dependency.
 */

export const EQUIPMENT_NOTES_MAX = 2000;
export const EQUIPMENT_NOTES_MESSAGE = `Notes must be ${EQUIPMENT_NOTES_MAX} characters or fewer`;
export const EQUIPMENT_NO_LINES_MESSAGE =
  "No equipment lines recorded. Add at least one line before submitting.";

/**
 * One equipment line as the panel, the email and the server pass it around. The arrangement
 * fields are Technical Support's position (PTR-39); they are absent wherever a line is shown
 * before Technical Support has seen it.
 */
export interface EquipmentLine {
  id: string;
  item: string;
  quantity: number;
  notes: string | null;
  arrangementStatus?: string;
  arrangementNotes?: string | null;
  unavailableReason?: string | null;
}

/**
 * The arrangement states Technical Support may set (PTR-39 AC3). `reserved` is deliberately not
 * here: only the reservation action (PTR-41) writes it, so an update can never claim it.
 */
export const ARRANGEMENT_STATES = ["requested", "not_required", "unavailable"] as const;

type ArrangementState = (typeof ARRANGEMENT_STATES)[number];

/** Every state a line can hold, settable or not, as the words people read. */
const ARRANGEMENT_STATE_LABELS: Record<ArrangementState | "reserved", string> = {
  requested: "Requested",
  reserved: "Reserved",
  not_required: "Not required",
  unavailable: "Unavailable",
};

/** The label for a stored status, or the raw value when it is not one we know. */
export function arrangementStateLabel(status: string): string {
  return (ARRANGEMENT_STATE_LABELS as Record<string, string | undefined>)[status] ?? status;
}

export const ARRANGEMENT_STATE_MESSAGE = "Choose requested, not required or unavailable";
export const ARRANGEMENT_REASON_MESSAGE = "Give a reason for marking this line unavailable";
export const ARRANGEMENT_REASON_LENGTH_MESSAGE = `Reason must be ${EQUIPMENT_NOTES_MAX} characters or fewer`;
export const ARRANGEMENT_EMPTY_UPDATE_MESSAGE = "Choose a state or add a note";
export const ARRANGEMENT_RESERVED_MESSAGE =
  "This line holds a reservation. Release the reservation before changing its state.";

/**
 * The statuses a Coordinator may edit equipment on: approved (AC1) and planning (AC4 says "not
 * yet confirmed", which is the `planning` stage before `confirmed`).
 */
const EQUIPMENT_EDITABLE_STATUSES = ["approved", "planning"] as const;

/** Whether the coordinator panel is editable at this event status. */
export function isEquipmentEditableStatus(status: string): boolean {
  return (EQUIPMENT_EDITABLE_STATUSES as readonly string[]).includes(status);
}

// Shared id shape: text primary key, same rule as `VenueRequestIdInput`.
const EquipmentLineId = z
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
  id: EquipmentLineId.optional(),
  item: z
    .string()
    .trim()
    .min(1, "Enter an equipment type")
    .max(EQUIPMENT_TYPE_MAX_LENGTH, EQUIPMENT_TYPE_MESSAGE),
  quantity: PositiveWholeNumber(
    EQUIPMENT_QUANTITY_MESSAGE,
    "Equipment quantity is larger than this record can store"
  ),
  notes: z.string().trim().max(EQUIPMENT_NOTES_MAX, EQUIPMENT_NOTES_MESSAGE).optional(),
});

export type EquipmentLineValues = z.infer<typeof EquipmentLineInput>;

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

export function parseEquipmentLineInput(data: unknown): EquipmentLineValues {
  return parseOrThrow(EquipmentLineInput, data);
}

/** PTR-38 AC4: remove one line. */
export const RemoveEquipmentLineInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  id: EquipmentLineId,
});

export type RemoveEquipmentLineValues = z.infer<typeof RemoveEquipmentLineInput>;

export function parseRemoveEquipmentLineInput(data: unknown): RemoveEquipmentLineValues {
  return parseOrThrow(RemoveEquipmentLineInput, data);
}

/** PTR-38 AC5: submit the full set to Technical Support. Only the event id is needed. */
export const SubmitEquipmentInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
});

export type SubmitEquipmentValues = z.infer<typeof SubmitEquipmentInput>;

export function parseSubmitEquipmentInput(data: unknown): SubmitEquipmentValues {
  return parseOrThrow(SubmitEquipmentInput, data);
}

/**
 * PTR-39 AC3: Technical Support sets a line's arrangement state, adds notes, or both. Each part
 * is optional so notes can be added to a line whose state may not move (a reserved one); an empty
 * `arrangementNotes` clears the note, and `unavailableReason` only matters for `unavailable`.
 */
const arrangementFields = {
  arrangementStatus: z.enum(ARRANGEMENT_STATES, { error: ARRANGEMENT_STATE_MESSAGE }).optional(),
  unavailableReason: z
    .string()
    .trim()
    .max(EQUIPMENT_NOTES_MAX, ARRANGEMENT_REASON_LENGTH_MESSAGE)
    .optional(),
  arrangementNotes: z.string().trim().max(EQUIPMENT_NOTES_MAX, EQUIPMENT_NOTES_MESSAGE).optional(),
};

/** Blank once whitespace, control and invisible format characters (U+200B, U+2060) are stripped. */
function isBlank(text: string | undefined): boolean {
  return (text ?? "").replace(/[\p{Cc}\p{Cf}\s]/gu, "") === "";
}

function requireReasonAndChange(
  value: { arrangementStatus?: string; unavailableReason?: string; arrangementNotes?: string },
  ctx: z.core.$RefinementCtx
) {
  if (value.arrangementStatus === "unavailable" && isBlank(value.unavailableReason)) {
    ctx.addIssue({
      code: "custom",
      message: ARRANGEMENT_REASON_MESSAGE,
      path: ["unavailableReason"],
    });
  } else if (value.arrangementStatus === undefined && value.arrangementNotes === undefined) {
    ctx.addIssue({ code: "custom", message: ARRANGEMENT_EMPTY_UPDATE_MESSAGE });
  }
}

export const ArrangementUpdateInput = z
  .object({
    eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
    id: EquipmentLineId,
    ...arrangementFields,
  })
  .superRefine(requireReasonAndChange);

export type ArrangementUpdateValues = z.infer<typeof ArrangementUpdateInput>;

export function parseArrangementUpdateInput(data: unknown): ArrangementUpdateValues {
  return parseOrThrow(ArrangementUpdateInput, data);
}

/** PTR-40: how much of one equipment type is free for an event's approved booking period. */
export const AvailabilityCheckInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  equipmentTypeId: z
    .int32({ error: "Choose an equipment type" })
    .positive("Choose an equipment type"),
  requestedQuantity: PositiveWholeNumber(
    EQUIPMENT_QUANTITY_MESSAGE,
    "Equipment quantity is larger than this record can store"
  ).optional(),
});

export type AvailabilityCheckValues = z.infer<typeof AvailabilityCheckInput>;

export function parseAvailabilityCheckInput(data: unknown): AvailabilityCheckValues {
  return parseOrThrow(AvailabilityCheckInput, data);
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

/**
 * The availability check form: string leaves in, the same gate as `AvailabilityCheckInput`. An
 * unchosen type becomes 0, which the gate refuses with its own message; a blank quantity is
 * simply not asked about.
 */
export const AvailabilityCheckFormInput = z
  .object({ equipmentTypeId: z.string(), requestedQuantity: z.string() })
  .transform((values): { equipmentTypeId: number; requestedQuantity?: number | undefined } => ({
    equipmentTypeId: Number(values.equipmentTypeId),
    requestedQuantity:
      values.requestedQuantity === "" ? undefined : parseWholeNumber(values.requestedQuantity),
  }))
  .pipe(AvailabilityCheckInput.omit({ eventId: true }));

/**
 * The arrangement form: string leaves in, the same gate as `ArrangementUpdateInput`. A reserved
 * line shows its state but cannot set one; the caller drops anything that is not a settable state.
 */
export const ArrangementFormInput = z
  .object({
    arrangementStatus: z.string(),
    unavailableReason: arrangementFields.unavailableReason.unwrap(),
    arrangementNotes: arrangementFields.arrangementNotes.unwrap(),
  })
  .superRefine(requireReasonAndChange);
