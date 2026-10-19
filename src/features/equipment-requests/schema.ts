import { z } from "zod";

import {
  EQUIPMENT_QUANTITY_MESSAGE,
  EQUIPMENT_TYPE_MAX_LENGTH,
  EQUIPMENT_TYPE_MESSAGE,
  parseWholeNumber,
  PositiveWholeNumber,
} from "#/features/event-requests/schema";

/** Routes and forms import this module. Keep it free of server-only dependencies. */

export const EQUIPMENT_NOTES_MAX = 2000;
export const EQUIPMENT_NOTES_MESSAGE = `Notes must be ${EQUIPMENT_NOTES_MAX} characters or fewer`;
export const EQUIPMENT_NO_LINES_MESSAGE =
  "No equipment lines recorded. Add at least one line before submitting.";

/** The equipment line used by the panel, email, and server. Include arrangement fields after Technical Support reviews the line. */
export interface EquipmentLine {
  id: string;
  item: string;
  quantity: number;
  notes: string | null;
  arrangementStatus?: string;
  arrangementNotes?: string | null;
  unavailableReason?: string | null;
  reservedQuantity?: number | null;
  venueRequestId?: string | null;
  windowChanged?: boolean;
  lastRelease?: EquipmentReleaseRecord | null;
  /** PTR-162 AC3: units short when overlapping reservations exceed held minus out-of-service. */
  shortfall?: number | null;
  /** PTR-162 AC5: the mapped catalogue type, null when the free-text item matches no type. */
  equipmentTypeId?: number | null;
}

/** States that Technical Support can set (PTR-39 AC3). Only the reserve action sets `reserved`. */
export const ARRANGEMENT_STATES = ["requested", "not_required", "unavailable"] as const;

export type ArrangementState = (typeof ARRANGEMENT_STATES)[number];

/** PTR-42: the most recent reduce/release on a line, kept after the reservation row is gone. */
export interface EquipmentReleaseRecord {
  /** Store the units given back in this change. */
  quantity: number;
  /** Store the member name or email. */
  byName: string;
  /** Store the change time as an ISO timestamp. */
  at: string;
}

/** The Reduce or release action requires held units and permission to arrange the line. */
export function canGiveBackUnits(line: {
  arrangeable?: boolean | undefined;
  reservedQuantity?: number | null | undefined;
}): boolean {
  return line.arrangeable !== false && (line.reservedQuantity ?? 0) > 0;
}

/** List all possible line states. Include states that a user cannot set. */
const ARRANGEMENT_STATE_LABELS: Record<ArrangementState | "reserved", string> = {
  requested: "Requested",
  reserved: "Reserved",
  not_required: "Not required",
  unavailable: "Unavailable",
};

/** Return the label for a known status, or the raw value for an unknown status. */
export function arrangementStateLabel(status: string): string {
  return (ARRANGEMENT_STATE_LABELS as Record<string, string | undefined>)[status] ?? status;
}

export const ARRANGEMENT_STATE_MESSAGE = "Choose requested, not required or unavailable";
export const ARRANGEMENT_REASON_MESSAGE = "Give a reason for marking this line unavailable";
export const ARRANGEMENT_REASON_LENGTH_MESSAGE = `Reason must be ${EQUIPMENT_NOTES_MAX} characters or fewer`;
export const ARRANGEMENT_EMPTY_UPDATE_MESSAGE = "Choose a state or add a note";
export const ARRANGEMENT_RESERVED_MESSAGE =
  "This line holds a reservation and its state cannot be changed.";
export const EQUIPMENT_RESERVED_EDIT_MESSAGE =
  "This line holds a reservation and its details cannot be changed.";
export const EQUIPMENT_RESERVED_REMOVE_MESSAGE =
  "This line holds a reservation and cannot be removed.";

/** Coordinators can edit equipment when an event is approved or in planning. */
const EQUIPMENT_EDITABLE_STATUSES = ["approved", "planning"] as const;

/** Check whether the coordinator panel accepts edits at this event status. */
export function isEquipmentEditableStatus(status: string): boolean {
  return (EQUIPMENT_EDITABLE_STATUSES as readonly string[]).includes(status);
}

// Use the same text ID rule as `VenueRequestIdInput`.
const EquipmentLineId = z
  .string({ error: "Choose an equipment line" })
  .trim()
  .min(1, "Choose an equipment line")
  .max(64, "Choose an equipment line");

/** PTR-38 AC1/AC4: Add or edit a saved equipment line. Require all three line fields. */
export const EquipmentLineInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  /** Include on edit. Omit on add. */
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

/** PTR-38 AC5: Submit the full equipment list for an event to Technical Support. */
export const SubmitEquipmentInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
});

export type SubmitEquipmentValues = z.infer<typeof SubmitEquipmentInput>;

export function parseSubmitEquipmentInput(data: unknown): SubmitEquipmentValues {
  return parseOrThrow(SubmitEquipmentInput, data);
}

/**
 * PTR-39 AC3: Technical Support can set the state, add notes, or do both. Each field is optional.
 * Notes can change while a line is reserved. An empty `arrangementNotes` clears the note.
 * `unavailableReason` applies only when the state is `unavailable`.
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

/** Return true when no visible characters remain. Strip whitespace, control characters, U+200B, and U+2060 first. */
export function isBlank(text: string | undefined): boolean {
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

/** PTR-40: Check how many units of an equipment type are free during an approved booking. */
const VenueBookingId = z
  .string()
  .trim()
  .min(1, "Choose a venue booking")
  .max(64, "Choose a venue booking");

export interface EquipmentBookingOption {
  id: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
}

export const AvailabilityCheckInput = z.object({
  venueRequestId: VenueBookingId.optional(),
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

/** PTR-41: The line ID for a reserve request. Use the 64-character text-key rule. */
const EquipmentRequestId = z
  .string({ error: "Equipment request ID is required" })
  .trim()
  .min(1, "Equipment request ID is required")
  .max(64, "Equipment request ID is required");

/** PTR-41: Reserve units of the line's type for the approved booking period. */
export const ReserveEquipmentInput = z.object({
  equipmentRequestId: EquipmentRequestId,
  venueRequestId: VenueBookingId.optional(),
  quantity: z
    .number({ error: "Quantity is required" })
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),
});

export type ReserveEquipmentValues = z.infer<typeof ReserveEquipmentInput>;

export function parseReserveEquipmentInput(data: unknown): ReserveEquipmentValues {
  return parseOrThrow(ReserveEquipmentInput, data);
}

/** PTR-41: Check how many units of the line's type are free during its booking. */
export const CheckLineAvailabilityInput = z.object({
  equipmentRequestId: EquipmentRequestId,
  venueRequestId: VenueBookingId.optional(),
});

export type CheckLineAvailabilityValues = z.infer<typeof CheckLineAvailabilityInput>;

export function parseCheckLineAvailabilityInput(data: unknown): CheckLineAvailabilityValues {
  return parseOrThrow(CheckLineAvailabilityInput, data);
}

// Reduce or release a reservation (PTR-42).

export const RELEASE_TOTAL_MESSAGE = "Enter the units to keep as a whole number, 0 to release";
export const RELEASE_NO_RESERVATION_MESSAGE = "This line holds no reservation to reduce or release";
export const RELEASE_NOT_LOWER_MESSAGE =
  "Enter fewer units than are currently reserved; use Reserve to hold more";
export const RELEASE_REASON_NEEDS_RELEASE_MESSAGE =
  "A reason marks the line unavailable, which goes with a full release: keep 0 units or leave the reason blank";

/**
 * PTR-42: Set the total units to keep. Use `0` to release all units. A reason sets the line to
 * `unavailable` instead of `requested` (criterion 1). Technical Support must choose this state.
 * A reason is valid only for a full release. Otherwise, the line could stay unavailable while it
 * holds units, with no action to move those units.
 */
const ReleaseEquipmentFields = z.object({
  equipmentRequestId: EquipmentRequestId,
  quantity: z
    .number({ error: RELEASE_TOTAL_MESSAGE })
    .int(RELEASE_TOTAL_MESSAGE)
    .nonnegative(RELEASE_TOTAL_MESSAGE),
  unavailableReason: z
    .string()
    .trim()
    .max(EQUIPMENT_NOTES_MAX, ARRANGEMENT_REASON_LENGTH_MESSAGE)
    .optional(),
});

function requireFullReleaseForReason(
  value: { quantity: number; unavailableReason?: string | undefined },
  ctx: z.core.$RefinementCtx
) {
  if (value.quantity > 0 && !isBlank(value.unavailableReason)) {
    ctx.addIssue({
      code: "custom",
      message: RELEASE_REASON_NEEDS_RELEASE_MESSAGE,
      path: ["unavailableReason"],
    });
  }
}

export const ReleaseEquipmentInput = ReleaseEquipmentFields.superRefine(
  requireFullReleaseForReason
);

export type ReleaseEquipmentValues = z.infer<typeof ReleaseEquipmentInput>;

export function parseReleaseEquipmentInput(data: unknown): ReleaseEquipmentValues {
  return parseOrThrow(ReleaseEquipmentInput, data);
}

/** PTR-43 AC1: Mark arrangements complete with only the event id. The handler verifies every line is `reserved` or `not_required`. */
export const CompleteArrangementsInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
});

export type CompleteArrangementsValues = z.infer<typeof CompleteArrangementsInput>;

export function parseCompleteArrangementsInput(data: unknown): CompleteArrangementsValues {
  return parseOrThrow(CompleteArrangementsInput, data);
}

/** PTR-43 AC2: Store a line ID and required reason when Technical Support cannot provide equipment. */
export const RecordUnavailableInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  id: EquipmentLineId,
  reason: z
    .string({ error: ARRANGEMENT_REASON_MESSAGE })
    .trim()
    .min(1, ARRANGEMENT_REASON_MESSAGE)
    .max(EQUIPMENT_NOTES_MAX, ARRANGEMENT_REASON_LENGTH_MESSAGE)
    .refine(value => !isBlank(value), ARRANGEMENT_REASON_MESSAGE),
  arrangementNotes: arrangementFields.arrangementNotes.optional(),
});

export type RecordUnavailableValues = z.infer<typeof RecordUnavailableInput>;

export function parseRecordUnavailableInput(data: unknown): RecordUnavailableValues {
  return parseOrThrow(RecordUnavailableInput, data);
}

// Form shapes. React inputs return strings.

/** React form values use strings. Parsing converts them to `EquipmentLineInput`. */
export const EquipmentLineFormShape = z.object({
  item: z.string(),
  quantity: z.string(),
  notes: z.string(),
});

/** Use server rules so each error marks its own input. The caller adds `eventId` and `id`. */
export const EquipmentLineFormInput = EquipmentLineFormShape.transform(
  (values): { item: string; quantity: number; notes?: string | undefined } => ({
    item: values.item,
    quantity: values.quantity === "" ? Number.NaN : parseWholeNumber(values.quantity),
    notes: values.notes === "" ? undefined : values.notes,
  })
).pipe(EquipmentLineInput.omit({ eventId: true, id: true }));

/** The reserve form stores quantity as a string. It uses `ReserveEquipmentInput` rules. The caller adds the line ID. */
export const ReserveEquipmentFormInput = z
  .object({ quantity: z.string() })
  .transform((values): { quantity: number } => ({
    quantity: values.quantity === "" ? Number.NaN : parseWholeNumber(values.quantity),
  }))
  .pipe(ReserveEquipmentInput.omit({ equipmentRequestId: true }));

/** The release form stores quantity as a string and uses `ReleaseEquipmentInput` rules. The caller adds the line ID. */
export const ReleaseEquipmentFormInput = z
  .object({ quantity: z.string(), unavailableReason: z.string() })
  .transform((values): { quantity: number; unavailableReason?: string | undefined } => ({
    quantity: values.quantity === "" ? Number.NaN : parseWholeNumber(values.quantity),
    unavailableReason: values.unavailableReason === "" ? undefined : values.unavailableReason,
  }))
  .pipe(
    ReleaseEquipmentFields.omit({ equipmentRequestId: true }).superRefine(
      requireFullReleaseForReason
    )
  );

/**
 * The availability form stores values as strings and uses `AvailabilityCheckInput` rules. An
 * empty type becomes 0 and fails validation. A blank quantity does not trigger validation.
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
 * The arrangement form stores values as strings and uses `ArrangementUpdateInput` rules. A
 * reserved line shows its state, but the caller omits that state from updates.
 */
export const ArrangementFormInput = z
  .object({
    arrangementStatus: z.string(),
    unavailableReason: arrangementFields.unavailableReason.unwrap(),
    arrangementNotes: arrangementFields.arrangementNotes.unwrap(),
  })
  .superRefine(requireReasonAndChange);

// ── Equipment catalogue (PTR-162) ────────────────────────────────────────────

export const EQUIPMENT_CATALOGUE_DUPLICATE_MESSAGE =
  "An equipment type with this name already exists";
export const EQUIPMENT_CATALOGUE_DELETE_REFUSAL =
  "This equipment type is in use and cannot be deleted.";
export const EQUIPMENT_TYPE_ID_MESSAGE = "Choose an equipment type";
export const EQUIPMENT_UNAVAILABILITY_REASON_MESSAGE =
  "Enter a reason for the out-of-service units";

/** PTR-162 AC1: add a type or change its quantity held. The id selects the path. */
export const EquipmentTypeInput = z.object({
  id: z.int32({ error: EQUIPMENT_TYPE_ID_MESSAGE }).positive(EQUIPMENT_TYPE_ID_MESSAGE).optional(),
  name: z
    .string()
    .trim()
    .min(1, "Enter an equipment type")
    .max(EQUIPMENT_TYPE_MAX_LENGTH, EQUIPMENT_TYPE_MESSAGE),
  quantityHeld: PositiveWholeNumber(
    EQUIPMENT_QUANTITY_MESSAGE,
    "Equipment quantity is larger than this record can store"
  ),
});

export type EquipmentTypeValues = z.infer<typeof EquipmentTypeInput>;

export function parseEquipmentTypeInput(data: unknown): EquipmentTypeValues {
  return parseOrThrow(EquipmentTypeInput, data);
}

export const EquipmentTypeIdInput = z.object(
  { id: z.int32({ error: EQUIPMENT_TYPE_ID_MESSAGE }).positive(EQUIPMENT_TYPE_ID_MESSAGE) },
  { error: EQUIPMENT_TYPE_ID_MESSAGE }
);

export type EquipmentTypeIdValues = z.infer<typeof EquipmentTypeIdInput>;

export function parseEquipmentTypeId(data: unknown): EquipmentTypeIdValues {
  return parseOrThrow(EquipmentTypeIdInput, data);
}

/** PTR-162 AC2: record or change the out-of-service quantity for one type and reason. */
export const EquipmentUnavailabilityInput = z.object({
  equipmentTypeId: z
    .int32({ error: EQUIPMENT_TYPE_ID_MESSAGE })
    .positive(EQUIPMENT_TYPE_ID_MESSAGE),
  reason: z
    .string({ error: EQUIPMENT_UNAVAILABILITY_REASON_MESSAGE })
    .trim()
    .min(1, EQUIPMENT_UNAVAILABILITY_REASON_MESSAGE)
    .max(EQUIPMENT_NOTES_MAX, ARRANGEMENT_REASON_LENGTH_MESSAGE)
    .refine(value => !isBlank(value), EQUIPMENT_UNAVAILABILITY_REASON_MESSAGE),
  quantityUnavailable: PositiveWholeNumber(
    EQUIPMENT_QUANTITY_MESSAGE,
    "Equipment quantity is larger than this record can store"
  ),
});

export type EquipmentUnavailabilityValues = z.infer<typeof EquipmentUnavailabilityInput>;

export function parseEquipmentUnavailabilityInput(data: unknown): EquipmentUnavailabilityValues {
  return parseOrThrow(EquipmentUnavailabilityInput, data);
}

/** PTR-162 AC5: map a free-text line to a catalogue type so reserve can use it. */
export const MapEquipmentLineInput = z.object({
  eventId: z.int32({ error: "Choose an event" }).positive("Choose an event"),
  id: EquipmentLineId,
  equipmentTypeId: z
    .int32({ error: EQUIPMENT_TYPE_ID_MESSAGE })
    .positive(EQUIPMENT_TYPE_ID_MESSAGE),
});

export type MapEquipmentLineValues = z.infer<typeof MapEquipmentLineInput>;

export function parseMapEquipmentLineInput(data: unknown): MapEquipmentLineValues {
  return parseOrThrow(MapEquipmentLineInput, data);
}

/** The catalogue form stores values as strings. Parsing converts them to `EquipmentTypeInput`. */
export const EquipmentTypeFormInput = z
  .object({ name: z.string(), quantityHeld: z.string() })
  .transform((values): { name: string; quantityHeld: number } => ({
    name: values.name,
    quantityHeld: values.quantityHeld === "" ? Number.NaN : parseWholeNumber(values.quantityHeld),
  }))
  .pipe(EquipmentTypeInput.omit({ id: true }));

/** The out-of-service form stores values as strings. The caller adds the type id. */
export const EquipmentUnavailabilityFormInput = z
  .object({ reason: z.string(), quantityUnavailable: z.string() })
  .transform((values): { reason: string; quantityUnavailable: number } => ({
    reason: values.reason,
    quantityUnavailable:
      values.quantityUnavailable === "" ? Number.NaN : parseWholeNumber(values.quantityUnavailable),
  }))
  .pipe(EquipmentUnavailabilityInput.omit({ equipmentTypeId: true }));
