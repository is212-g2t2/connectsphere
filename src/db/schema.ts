import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  ClarificationAmendment,
  ClarificationField,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";
import type { NotificationPayload } from "#/features/notifications/message";
import type { OperatingHours, VenueLayout } from "#/features/venues/schema";

import { user } from "./auth-schema";

/**
 * The full set of event stages (PTR-21). This is the only field that records an event's stage.
 * Only a user's status action changes it. A venue or equipment change does not change the stage.
 * The `event_requests_decision_matches_status` CHECK ties each decision to its stage. The client
 * repeats this set in `src/features/event-requests/schema.ts`; `tests/unit/db-schema.test.ts` keeps
 * both sets in sync. Add a stage with a generated `ALTER TYPE` migration.
 */
export const eventRequestStatus = pgEnum("event_request_status", [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "awaiting_organiser",
  // PTR-21 criterion 1: add the remaining stages now. PTR-24, PTR-25 and PTR-54 can then write
  // `confirmed`, `completed` and `cancelled`. `planning` is the stage between approval and
  // confirmation in brief section 5, steps 6–9.
  "planning",
  "confirmed",
  "completed",
  "cancelled",
]);

export const eventRequests = pgTable(
  "event_requests",
  {
    id: serial("id").primaryKey(),
    organiserId: text("organiser_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: eventRequestStatus("status").notNull().default("draft"),
    /** PTR-13 criterion 2: submission time. Null for drafts; the CHECK requires it for every other status. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /**
     * PTR-15: the Event Coordinator chosen at submission. One column limits each row to one
     * Coordinator (criterion 2). Drafts have no Coordinator (PTR-9 criterion 4). A submitted
     * request can have no Coordinator only when none was available (criterion 5); that request
     * stays in the unassigned list. `set null` keeps an event if staff leave. The event then waits
     * for a new Coordinator (PTR-16), and `assignedAt` preserves the previous assignment time.
     */
    assignedCoordinatorId: text("assigned_coordinator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    /** PTR-20: keep decision attribution after the request leaves review. */
    decisionReason: text("decision_reason"),
    decidedByCoordinatorId: text("decided_by_coordinator_id"),
    decidedByCoordinatorName: text("decided_by_coordinator_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * PTR-24 AC4: who confirmed the event and when. These fields are separate from the decision
     * fields, so they preserve approval attribution. Store the id and name as snapshots so account
     * deletion does not remove them. Null until confirmation.
     */
    confirmedById: text("confirmed_by_id"),
    confirmedByName: text("confirmed_by_name"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /**
     * PTR-25 AC3: who completed the event and when. Store the id and name as snapshots so account
     * deletion does not remove the audit record.
     */
    completedById: text("completed_by_id"),
    completedByName: text("completed_by_name"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * PTR-54 AC1: who cancelled the event and when (PTR-21 AC4). Store the id and name as
     * snapshots so account deletion does not remove the record. Null until cancellation.
     */
    cancelledById: text("cancelled_by_id"),
    cancelledByName: text("cancelled_by_name"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    eventName: text("event_name").notNull().default(""),
    purpose: text("purpose").notNull().default(""),
    /**
     * PTR-10: use JSONB instead of a `timestamp` pair because an organiser can propose several
     * date windows. The stored strings match the submitted `datetime-local` values.
     */
    proposedDates: jsonb("proposed_dates")
      .$type<EventRequestDraftValues["proposedDates"]>()
      .notNull()
      .default([]),
    expectedAttendance: integer("expected_attendance"),
    description: text("description").notNull().default(""),
    eventType: text("event_type").notNull().default(""),
    venueRequirements: text("venue_requirements").notNull().default(""),
    roomLayoutPreference: text("room_layout_preference").notNull().default(""),
    accessibilityRequirements: text("accessibility_requirements").notNull().default(""),
    equipmentRequirements: jsonb("equipment_requirements")
      .$type<EventRequestDraftValues["equipmentRequirements"]>()
      .notNull()
      .default([]),
    /**
     * PTR-38 AC5: when the Coordinator submitted the equipment list to Technical Support. Null
     * until then; the submit handler sets it once, and the PTR-39 work list reads it.
     */
    equipmentSubmittedAt: timestamp("equipment_submitted_at", { withTimezone: true }),
    /**
     * PTR-43: when Technical Support Staff completed the equipment arrangements and who did it.
     * Null until then. Clear these fields after any line change: add, edit, remove, notes, state
     * change, or reservation reduction or release. This keeps the record valid only while its
     * arrangements stay unchanged.
     */
    equipmentArrangementsCompletedAt: timestamp("equipment_arrangements_completed_at", {
      withTimezone: true,
    }),
    equipmentArrangementsCompletedById: text("equipment_arrangements_completed_by_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    specialArrangements: text("special_arrangements").notNull().default(""),
    /**
     * PTR-11: whether attendees may register and the registration terms. Store both window fields
     * as text, like `proposedDates` uses JSONB, so `datetime-local` values keep their spelling.
     * The save path enforces a fixed-width format, which lets the CHECK compare dates in order. A
     * `timestamp` column would add seconds, such as `18:00:00`.
     */
    registrationEnabled: boolean("registration_enabled").notNull().default(false),
    registrationCapacity: integer("registration_capacity"),
    registrationOpensAt: text("registration_opens_at"),
    registrationClosesAt: text("registration_closes_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  table => [
    // PTR-13 criterion 2: drafts have no submission time. Every later status keeps the time it left draft.
    check(
      "event_requests_submission_time_matches_status",
      sql`(${table.status} = 'draft' and ${table.submittedAt} is null) or (${table.status} <> 'draft' and ${table.submittedAt} is not null)`
    ),
    // PTR-15: a Coordinator requires an assignment time. `ON DELETE SET NULL` can remove the
    // Coordinator and keep the time, so staff accounts with events can be deleted.
    check(
      "event_requests_coordinator_has_assignment_time",
      sql`${table.assignedCoordinatorId} is null or ${table.assignedAt} is not null`
    ),
    // PTR-9 criterion 4: drafts have no Coordinator. Check only the id because no path sets
    // `assignedAt` on a draft. A time without an id is valid under the CHECK above.
    check(
      "event_requests_draft_has_no_coordinator",
      sql`${table.status} <> 'draft' or ${table.assignedCoordinatorId} is null`
    ),
    // Keep decision attribution from approval or rejection through later stages. Require it for
    // those stages and omit it before a decision. Cancellation can happen before or after a
    // decision (PTR-54), so `cancelled` allows all attribution fields or none.
    check(
      "event_requests_decision_matches_status",
      sql`(${table.status}::text in ('approved', 'rejected', 'planning', 'confirmed', 'completed') and ${table.decidedByCoordinatorId} is not null and btrim(${table.decidedByCoordinatorId}) <> '' and ${table.decidedByCoordinatorName} is not null and btrim(${table.decidedByCoordinatorName}) <> '' and ${table.decidedAt} is not null) or (${table.status}::text in ('draft', 'submitted', 'under_review', 'awaiting_organiser') and ${table.decisionReason} is null and ${table.decidedByCoordinatorId} is null and ${table.decidedByCoordinatorName} is null and ${table.decidedAt} is null) or (${table.status}::text = 'cancelled' and ((${table.decidedByCoordinatorId} is not null and btrim(${table.decidedByCoordinatorId}) <> '' and ${table.decidedByCoordinatorName} is not null and btrim(${table.decidedByCoordinatorName}) <> '' and ${table.decidedAt} is not null) or (${table.decisionReason} is null and ${table.decidedByCoordinatorId} is null and ${table.decidedByCoordinatorName} is null and ${table.decidedAt} is null)))`
    ),
    // PTR-24 AC4: confirmed events require all three confirmation fields. Earlier stages must
    // omit them. `completed` and `cancelled` keep the confirmation record.
    check(
      "event_requests_confirmation_matches_status",
      sql`(${table.status}::text = 'confirmed' and ${table.confirmedById} is not null and btrim(${table.confirmedById}) <> '' and ${table.confirmedByName} is not null and btrim(${table.confirmedByName}) <> '' and ${table.confirmedAt} is not null) or (${table.status}::text in ('completed', 'cancelled') and ((${table.confirmedById} is not null and btrim(${table.confirmedById}) <> '' and ${table.confirmedByName} is not null and btrim(${table.confirmedByName}) <> '' and ${table.confirmedAt} is not null) or (${table.confirmedById} is null and ${table.confirmedByName} is null and ${table.confirmedAt} is null))) or (${table.status}::text not in ('confirmed', 'completed', 'cancelled') and ${table.confirmedById} is null and ${table.confirmedByName} is null and ${table.confirmedAt} is null)`
    ),
    // PTR-25 AC3: completion requires all three audit fields. A later cancellation can keep them;
    // earlier stages cannot have them.
    check(
      "event_requests_completion_matches_status",
      sql`(${table.status}::text = 'completed' and ${table.completedById} is not null and btrim(${table.completedById}) <> '' and ${table.completedByName} is not null and btrim(${table.completedByName}) <> '' and ${table.completedAt} is not null) or (${table.status}::text = 'cancelled' and ((${table.completedById} is not null and btrim(${table.completedById}) <> '' and ${table.completedByName} is not null and btrim(${table.completedByName}) <> '' and ${table.completedAt} is not null) or (${table.completedById} is null and ${table.completedByName} is null and ${table.completedAt} is null))) or (${table.status}::text not in ('completed', 'cancelled') and ${table.completedById} is null and ${table.completedByName} is null and ${table.completedAt} is null)`
    ),
    // PTR-54 AC1: cancelled events require all cancellation fields. Other stages cannot have them.
    check(
      "event_requests_cancellation_matches_status",
      sql`(${table.status}::text = 'cancelled' and ${table.cancelledById} is not null and btrim(${table.cancelledById}) <> '' and ${table.cancelledByName} is not null and btrim(${table.cancelledByName}) <> '' and ${table.cancelledAt} is not null) or (${table.status}::text <> 'cancelled' and ${table.cancelledById} is null and ${table.cancelledByName} is null and ${table.cancelledAt} is null)`
    ),
    check(
      "event_requests_rejection_has_reason",
      sql`${table.status}::text <> 'rejected' or (${table.decisionReason} is not null and btrim(${table.decisionReason}) <> '')`
    ),
    // Criteria 2 and 5: require registration terms exactly when registration is enabled.
    check(
      "event_requests_registration_terms_match_enabled",
      sql`(${table.registrationEnabled} and ${table.registrationCapacity} is not null and ${table.registrationOpensAt} is not null and ${table.registrationClosesAt} is not null) or (not ${table.registrationEnabled} and ${table.registrationCapacity} is null and ${table.registrationOpensAt} is null and ${table.registrationClosesAt} is null)`
    ),
    check(
      "event_requests_registration_capacity_positive",
      sql`${table.registrationCapacity} is null or ${table.registrationCapacity} > 0`
    ),
    check(
      "event_requests_registration_closes_after_opens",
      sql`${table.registrationOpensAt} is null or ${table.registrationClosesAt} is null or ${table.registrationClosesAt} > ${table.registrationOpensAt}`
    ),
    // PTR-8 looks up event access by owner or assignee. Index both columns because PostgreSQL does
    // not index foreign keys or columns by default.
    index("event_requests_organiser_id_idx").on(table.organiserId),
    index("event_requests_assigned_coordinator_id_idx").on(table.assignedCoordinatorId),
    index("event_requests_equipment_arrangements_completed_by_id_idx").on(
      table.equipmentArrangementsCompletedById
    ),
  ]
);

/** PTR-16: append-only handover history. User id snapshots preserve attribution after account deletion. */
export const eventAssignments = pgTable("event_assignments", {
  id: serial("id").primaryKey(),
  eventRequestId: integer("event_request_id")
    .notNull()
    .references(() => eventRequests.id, { onDelete: "cascade" }),
  fromCoordinatorId: text("from_coordinator_id"),
  toCoordinatorId: text("to_coordinator_id").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * PTR-110: the incoming Coordinator's decision on a pending handover. A null `decision` means
 * pending. The CHECK below requires all decision fields together. The partial unique index allows
 * one live handover per event, so a new handover must first resolve the previous one.
 */
export const eventHandoverDecision = pgEnum("event_handover_decision", ["accepted", "declined"]);

export const eventHandovers = pgTable(
  "event_handovers",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    /** Snapshots preserve attribution after account deletion, as in `eventAssignments`. */
    fromCoordinatorId: text("from_coordinator_id").notNull(),
    toCoordinatorId: text("to_coordinator_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decision: eventHandoverDecision("decision"),
    decidedById: text("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  table => [
    check(
      "event_handovers_decision_complete",
      sql`(${table.decision} is null and ${table.decidedById} is null and ${table.decidedAt} is null) or (${table.decision} is not null and ${table.decidedById} is not null and ${table.decidedAt} is not null)`
    ),
    // PTR-110: allow one pending handover at a time. A new handover replaces the old row in one
    // transaction. This index also protects writes that skip that transaction.
    uniqueIndex("event_handovers_pending_event_idx")
      .on(table.eventRequestId)
      .where(sql`${table.decision} is null`),
    // The incoming Coordinator's list filters by recipient.
    index("event_handovers_to_coordinator_id_idx").on(table.toCoordinatorId),
  ]
);

/**
 * PTR-18: clarification requests from the assigned Coordinator. User id snapshots preserve
 * attribution after account deletion. The question cannot change after insert; the Coordinator
 * must raise another request to add a question. The Organiser writes the reply fields once.
 */
export const clarificationRequests = pgTable(
  "clarification_requests",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    /** Snapshot of the Coordinator who raised the clarification. */
    coordinatorId: text("coordinator_id").notNull(),
    body: text("body").notNull(),
    permittedFields: text("permitted_fields")
      .array()
      .$type<ClarificationField[]>()
      .notNull()
      .default([]),
    replyBody: text("reply_body"),
    repliedByOrganiserId: text("replied_by_organiser_id"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    /**
     * PTR-19: fields that the reply changed, as `{field, from, to}` entries. Both detail pages show
     * these changes beside the reply. Empty if the reply made no changes. `jsonb` keeps the values
     * as the request stored them.
     */
    amendments: jsonb("amendments").$type<ClarificationAmendment[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index("clarification_requests_event_request_id_idx").on(table.eventRequestId),
    check(
      "clarification_requests_reply_complete",
      sql`(${table.replyBody} is null and ${table.repliedByOrganiserId} is null and ${table.repliedAt} is null) or (${table.replyBody} is not null and btrim(${table.replyBody}) <> '' and ${table.repliedByOrganiserId} is not null and ${table.repliedAt} is not null)`
    ),
  ]
);

/** PTR-52: what the Coordinator did with a change request. Null while the request waits. */
export const eventChangeOutcome = pgEnum("event_change_outcome", ["applied", "declined"]);

/**
 * PTR-51: an Organiser's requested change after submission. Keep the requested value outside
 * `event_requests` so a request cannot change recorded event data. Keep the request text unchanged
 * after insert. PTR-52 records one outcome: `applied` when the Coordinator saves the change, or
 * `declined` with a reason. Store the processor's id and name as snapshots. Several requests can
 * wait at once.
 */
export const eventChangeRequests = pgTable(
  "event_change_requests",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    organiserId: text("organiser_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    whatShouldChange: text("what_should_change").notNull(),
    requestedValue: text("requested_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: eventChangeOutcome("outcome"),
    /** PTR-52 AC2: why the Coordinator declined; required for a decline, absent otherwise. */
    declineReason: text("decline_reason"),
    processedById: text("processed_by_id"),
    processedByName: text("processed_by_name"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  table => [
    index("event_change_requests_event_request_id_idx").on(table.eventRequestId),
    check(
      "event_change_requests_outcome_complete",
      sql`(${table.outcome} is null and ${table.processedById} is null and ${table.processedByName} is null and ${table.processedAt} is null and ${table.declineReason} is null) or (${table.outcome} is not null and ${table.processedById} is not null and btrim(${table.processedById}) <> '' and ${table.processedByName} is not null and btrim(${table.processedByName}) <> '' and ${table.processedAt} is not null)`
    ),
    check(
      "event_change_requests_decline_has_reason",
      sql`(${table.outcome}::text = 'declined' and coalesce(${table.declineReason}, '') ~ '[^[:space:]]') or (${table.outcome} is distinct from 'declined' and ${table.declineReason} is null)`
    ),
    check(
      "event_change_requests_what_should_change_present",
      sql`btrim(${table.whatShouldChange}) <> '' and char_length(${table.whatShouldChange}) <= 2000`
    ),
    check(
      "event_change_requests_requested_value_present",
      sql`btrim(${table.requestedValue}) <> '' and char_length(${table.requestedValue}) <= 2000`
    ),
  ]
);

/**
 * PTR-53/54: the Coordinator's decision on a cancellation request. Null while the request waits.
 */
export const eventCancellationOutcome = pgEnum("event_cancellation_outcome", [
  "cancelled",
  "declined",
]);

/**
 * PTR-53: an Organiser's request to cancel an event. Keep it separate from
 * `event_change_requests` because it names no field or new value. PTR-54 changes the event status
 * when the Coordinator processes the request. Keep the outcome on this row and store the
 * processor's id and name as snapshots.
 */
export const eventCancellationRequests = pgTable(
  "event_cancellation_requests",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    organiserId: text("organiser_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: eventCancellationOutcome("outcome"),
    /** PTR-54 AC8: why the Coordinator declined; required for a decline, absent otherwise. */
    declineReason: text("decline_reason"),
    processedById: text("processed_by_id"),
    processedByName: text("processed_by_name"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  table => [
    index("event_cancellation_requests_event_request_id_idx").on(table.eventRequestId),
    // Allow one pending request at a time, so a double-click cannot add two.
    uniqueIndex("event_cancellation_requests_open_event_idx")
      .on(table.eventRequestId)
      .where(sql`${table.outcome} is null`),
    check(
      "event_cancellation_requests_outcome_complete",
      sql`(${table.outcome} is null and ${table.processedById} is null and ${table.processedByName} is null and ${table.processedAt} is null and ${table.declineReason} is null) or (${table.outcome} is not null and ${table.processedById} is not null and btrim(${table.processedById}) <> '' and ${table.processedByName} is not null and btrim(${table.processedByName}) <> '' and ${table.processedAt} is not null)`
    ),
    check(
      "event_cancellation_requests_decline_has_reason",
      sql`(${table.outcome}::text = 'declined' and coalesce(${table.declineReason}, '') ~ '[^[:space:]]') or (${table.outcome} is distinct from 'declined' and ${table.declineReason} is null)`
    ),
  ]
);

/**
 * PTR-22 AC4: one append-only row for each field changed by an event information update. Store the
 * field, old and new values, user, and time (brief section 8f). `field` is a `CLARIFICATION_FIELDS`
 * key. For example, `attendeeRegistration` covers four columns in one row, as it does for a
 * clarification. Store `amendment` as `{ from, to }`. It must be an object because Drizzle parses
 * a top-level JSONB string again when it reads the row. It would read `"2031"` as a number. Store
 * the user's id and name as snapshots so account deletion keeps the record.
 */
export const eventInformationChanges = pgTable(
  "event_information_changes",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    field: text("field").$type<ClarificationField>().notNull(),
    amendment: jsonb("amendment").$type<Omit<ClarificationAmendment, "field">>().notNull(),
    changedById: text("changed_by_id").notNull(),
    changedByName: text("changed_by_name").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index("event_information_changes_event_request_id_idx").on(table.eventRequestId)]
);

export const venues = pgTable(
  "venues",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    location: text("location").notNull(),
    // Keep criterion 3 in the database too. The integer column and CHECK require a positive whole
    // number, whichever path writes the row.
    maxCapacity: integer("max_capacity").notNull(),
    facilities: text("facilities").array().notNull().default([]),
    accessibilityFeatures: text("accessibility_features").array().notNull().default([]),
    // `VenueInput` limits values to `VENUE_LAYOUTS`. This is not a PostgreSQL enum, so widening
    // the list requires a code change, not an `ALTER TYPE` migration.
    supportedLayouts: text("supported_layouts")
      .array()
      .$type<VenueLayout[]>()
      .notNull()
      .default([]),
    // Shape documented on `OperatingHours`; `OperatingHoursSchema` is what refuses a bad one.
    operatingHours: jsonb("operating_hours").$type<OperatingHours>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  table => [check("venues_max_capacity_positive", sql`${table.maxCapacity} > 0`)]
);

/**
 * Periods when a venue is not available for requests, such as for maintenance, renovation, or
 * internal use. Version 0.1 does not manage these periods (brief section 9). The seed creates them
 * (PTR-59 criterion 4), and the availability calendar reads them (PTR-28). String timestamps
 * preserve the `datetime-local` values.
 */
export const venueUnavailability = pgTable(
  "venue_unavailability",
  {
    id: serial("id").primaryKey(),
    venueId: integer("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    check("venue_unavailability_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
    // This unique key prevents the seed from adding each period more than once.
    uniqueIndex("venue_unavailability_period_idx").on(table.venueId, table.startsAt, table.endsAt),
  ]
);

export * from "./auth-schema";

/**
 * PTR-8: statuses for event child records. As with `eventRequestStatus`, include only statuses
 * used by current stories. Add new statuses with a generated `ALTER TYPE` migration. PTR-31 added
 * `withdrawn`; keep withdrawn requests so their history remains. PTR-36 added `approved`; an
 * approved request reserves the venue. Migration 0019's exclusion constraint checks the status
 * label, not its order. PTR-34 added `rejected` and PTR-37 added `released`; neither reserves a
 * venue because the constraint checks only `approved`.
 */
export const venueRequestStatus = pgEnum("venue_request_status", [
  "pending",
  "withdrawn",
  "approved",
  "rejected",
  "released",
]);

export const venueHoldStatus = pgEnum("venue_hold_status", ["held", "released"]);

/**
 * PTR-39 added `not_required` and `unavailable`, which Technical Support sets by hand.
 * The reservation action sets `reserved` (PTR-41).
 */
export const equipmentArrangementStatus = pgEnum("equipment_arrangement_status", [
  "requested",
  "reserved",
  "not_required",
  "unavailable",
]);

/**
 * PTR-45 AC4: each registration has one of these statuses. Only `registered` counts against
 * capacity. PTR-47 changes the registration's row, so `withdrawn` preserves its history. Removed
 * VIP registrations also use `withdrawn` (PTR-111 AC6).
 */
export const eventRegistrationStatus = pgEnum("event_registration_status", [
  "registered",
  "withdrawn",
]);

/**
 * PTR-8: until PTR-21/24 creates an event record, the submitted request represents the event.
 * Each child below references `event_requests.id`, not a separate events table. `venue_requests`
 * and `equipment_requests` go to Venue Staff and Technical Support (PTR-8 criterion 3). PTR-31
 * added the venue request fields.
 *
 * PTR-36: approved rows for one venue cannot overlap. Migration
 * `0019_booking-overlap-constraint` adds the partial exclusion constraint. Drizzle cannot express
 * it here and never drops it. See docs/adrs/ADR-5-venue-booking-overlap.md.
 */
export const venueRequests = pgTable(
  "venue_requests",
  {
    id: text("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    /**
     * PTR-31 criterion 1: the venue chosen by the Coordinator. Keep the default `no action` so
     * deleting a venue cannot remove a request. Venue deletion is not supported yet.
     */
    venueId: integer("venue_id")
      .notNull()
      .references(() => venues.id),
    /**
     * PTR-31 criterion 1: the requested window. Use the string format from `venueUnavailability`
     * so `datetime-local` values keep their spelling. The CHECK compares fixed-width strings as
     * times. The Coordinator submits a date, start time, and end time; this field stores them as
     * one pair.
     */
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    /**
     * The Venue Staff member who approved or rejected the request. Null on creation (PTR-31)
     * because the queue is shared and does not assign requests to a person.
     */
    assignedStaffId: text("assigned_staff_id").references(() => user.id, { onDelete: "set null" }),
    /** PTR-37: last Venue Staff actor to release or amend this booking. */
    lastChangedByStaffId: text("last_changed_by_staff_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** PTR-37: save the actor's name so staff account deletion does not remove it. */
    lastChangedByStaffName: text("last_changed_by_staff_name"),
    /** PTR-37: when Venue Staff released or amended the booking. */
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    /**
     * PTR-31 criterion 5: the Coordinator who raised the request, saved as a snapshot. Withdrawal
     * checks this field, not the event's current assignee. Reassignment therefore does not give
     * another Coordinator permission to withdraw the request. Use `set null`, as for
     * `assignedCoordinatorId`, so deleting a staff account does not delete its requests or approved
     * bookings. A null value means the user is not the request's raiser.
     */
    requestedById: text("requested_by_id").references(() => user.id, { onDelete: "set null" }),
    status: venueRequestStatus("status").default("pending").notNull(),
    /**
     * PTR-34 criterion 1: why Venue Staff rejected the request. Keep the reason on the row so the
     * Coordinator can see it on the event. The CHECK requires a reason for every rejected row.
     */
    rejectionReason: text("rejection_reason"),
    /** PTR-37: the required operational reason when an approved booking is released. */
    releaseReason: text("release_reason"),
    /**
     * PTR-34 criterion 2: an alternative suggested by Venue Staff. Each field is optional and
     * independent. PTR-35 uses these fields to pre-fill a new request. `set null` keeps the
     * rejection and reason if someone removes the suggested venue.
     */
    suggestedVenueId: integer("suggested_venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    suggestedDate: date("suggested_date", { mode: "string" }),
    suggestedStartTime: time("suggested_start_time"),
    suggestedEndTime: time("suggested_end_time"),
    /** When the Coordinator raised the request; PTR-32 uses this for queue order. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // As in `venues` and `eventRequests`, record when this row last changed because withdrawal
    // changes its status.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  table => [
    // Criterion 1: the end time must not come before the start time.
    check("venue_requests_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
    // PTR-34 criterion 1: enforce this for every writer. Compare the status as text because
    // PostgreSQL rejects a new enum value in the same transaction that adds it. `[:space:]` finds
    // tabs and newlines as well as spaces; `btrim` alone finds only spaces. The Zod schema trims
    // and limits the reason. This CHECK protects other writers.
    check(
      "venue_requests_rejection_has_reason",
      sql`${table.status}::text <> 'rejected' or coalesce(${table.rejectionReason}, '') ~ '[^[:space:]]'`
    ),
    check(
      "venue_requests_release_has_reason",
      sql`${table.status}::text <> 'released' or coalesce(${table.releaseReason}, '') ~ '[^[:space:]]'`
    ),
    // Criterion 1: prevent two live requests for one venue and event. This partial index frees the
    // pair after withdrawal.
    uniqueIndex("venue_requests_pending_event_venue_idx")
      .on(table.eventId, table.venueId)
      .where(sql`${table.status} = 'pending'`),
    // Look up both directions for each request: a caller's assignments and requests for events
    // the caller can see.
    index("venue_requests_event_id_idx").on(table.eventId),
    index("venue_requests_assigned_staff_id_idx").on(table.assignedStaffId),
    // The availability calendar and search read approved bookings by venue and period, and
    // the amend path checks the same shape for conflicts. The partial predicate keeps this
    // index to rows that occupy the venue.
    index("venue_requests_venue_period_idx")
      .on(table.venueId, table.startsAt, table.endsAt)
      .where(sql`${table.status} = 'approved'`),
    // PTR-37's shared approved-booking queue filters by status and start time.
    index("venue_requests_approved_starts_at_idx")
      .on(table.startsAt)
      // This IMMUTABLE wrapper exists for ADR-5. It also lets this migration use the enum value
      // that it added earlier in the same transaction; PostgreSQL 15 otherwise refuses that use.
      .where(sql`venue_request_occupies_venue(${table.status})`),
  ]
);

/**
 * PTR-109: tentative venue holds from an event's assigned Coordinator. A hold reserves a venue
 * before final booking confirmation. Each venue and time slot can have one active hold or one
 * approved booking.
 */
export const venueHolds = pgTable(
  "venue_holds",
  {
    id: text("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    venueId: integer("venue_id")
      .notNull()
      .references(() => venues.id),
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    status: venueHoldStatus("status").default("held").notNull(),
    heldById: text("held_by_id").references(() => user.id, { onDelete: "set null" }),
    releasedById: text("released_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  table => [
    check("venue_holds_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
    index("venue_holds_event_id_idx").on(table.eventId),
    index("venue_holds_venue_id_starts_at_idx").on(table.venueId, table.startsAt),
    index("venue_holds_held_by_id_idx").on(table.heldById),
    index("venue_holds_released_by_id_idx").on(table.releasedById),
  ]
);

export const equipmentRequests = pgTable(
  "equipment_requests",
  {
    id: text("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    equipmentTypeId: integer("equipment_type_id").references(() => equipmentTypes.id, {
      onDelete: "restrict",
    }),
    assignedStaffId: text("assigned_staff_id").references(() => user.id, { onDelete: "set null" }),
    item: text("item").notNull(),
    /** PTR-38 criterion 1: a positive whole number. The CHECK below also applies to other writers. */
    quantity: integer("quantity").notNull(),
    arrangementStatus: equipmentArrangementStatus("arrangement_status")
      .default("requested")
      .notNull(),
    notes: text("notes"),
    /** PTR-39: Technical Support's note. Keep it separate from the Coordinator's `notes`. Null if absent. */
    arrangementNotes: text("arrangement_notes"),
    /** PTR-39 AC3: why the line is `unavailable`; null in every other state. */
    unavailableReason: text("unavailable_reason"),
    /** PTR-42: last Technical Support user who reduced or released this reservation. */
    lastReleasedByStaffId: text("last_released_by_staff_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** PTR-42: save the actor's name so staff account deletion does not remove it. */
    lastReleasedByStaffName: text("last_released_by_staff_name"),
    /** PTR-42: when Technical Support reduced or released the reservation. */
    lastReleasedAt: timestamp("last_released_at", { withTimezone: true }),
    /** PTR-42: units given back in the most recent reduce or release. */
    lastReleasedQuantity: integer("last_released_quantity"),
  },
  table => [
    check("equipment_requests_quantity_positive", sql`${table.quantity} > 0`),
    index("equipment_requests_event_id_idx").on(table.eventId),
    index("equipment_requests_assigned_staff_id_idx").on(table.assignedStaffId),
    index("equipment_requests_last_released_by_staff_id_idx").on(table.lastReleasedByStaffId),
    // PTR-39 AC3: reject a missing or whitespace-only reason. The Zod rule
    // (`requireReasonAndChange`) also rejects control characters, such as zero-width spaces, that
    // this CHECK allows. Compare the status as text because PostgreSQL will not use an enum value
    // in the transaction that adds it. `[:space:]` also finds tabs and newlines.
    check(
      "equipment_requests_unavailable_has_reason",
      sql`${table.arrangementStatus}::text <> 'unavailable' or coalesce(${table.unavailableReason}, '') ~ '[^[:space:]]'`
    ),
    check(
      "equipment_requests_last_released_positive",
      sql`${table.lastReleasedQuantity} is null or ${table.lastReleasedQuantity} > 0`
    ),
  ]
);

/** PTR-40: equipment types and the total quantity of each type at a venue. */
export const equipmentTypes = pgTable(
  "equipment_types",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    quantityHeld: integer("quantity_held").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [check("equipment_types_quantity_held_positive", sql`${table.quantityHeld} > 0`)]
);

/**
 * PTR-40 AC2: equipment units that are damaged, under maintenance, or otherwise out of service.
 * Keep one row per reason so an update does not count the same units twice.
 */
export const equipmentUnavailability = pgTable(
  "equipment_unavailability",
  {
    id: serial("id").primaryKey(),
    equipmentTypeId: integer("equipment_type_id")
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: "cascade" }),
    quantityUnavailable: integer("quantity_unavailable").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    check("equipment_unavailability_quantity_positive", sql`${table.quantityUnavailable} > 0`),
    uniqueIndex("equipment_unavailability_type_reason_idx").on(table.equipmentTypeId, table.reason),
  ]
);

/**
 * PTR-40 reservation data: units of a type committed to an event's equipment line. Store the
 * period at reservation time so later booking changes do not move it. PTR-41 owns writes.
 */
export const equipmentReservations = pgTable(
  "equipment_reservations",
  {
    id: text("id").primaryKey(),
    equipmentRequestId: text("equipment_request_id")
      .notNull()
      .references(() => equipmentRequests.id, { onDelete: "cascade" }),
    equipmentTypeId: integer("equipment_type_id")
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    /** Snapshot of the approved booking window the reservation was made against. */
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("equipment_reservations_equipment_request_id_idx").on(table.equipmentRequestId),
    check("equipment_reservations_quantity_positive", sql`${table.quantity} > 0`),
    // The overlap check filters by type and period, so the database reads this index.
    index("equipment_reservations_type_period_idx").on(
      table.equipmentTypeId,
      table.startsAt,
      table.endsAt
    ),
    check("equipment_reservations_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ]
);

export const eventRegistrations = pgTable(
  "event_registrations",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    attendeeId: text("attendee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: eventRegistrationStatus("status").default("registered").notNull(),
    /** When the Attendee or a VIP's inviter recorded the registration. */
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * PTR-111: an Organiser or assigned Coordinator registered an invited Attendee. A VIP takes a
     * venue place, but does not count toward registration capacity.
     */
    vip: boolean("vip").notNull().default(false),
  },
  table => [
    primaryKey({ columns: [table.eventId, table.attendeeId] }),
    // The primary key starts with `event_id`, so index an Attendee's registrations separately.
    index("event_registrations_attendee_id_idx").on(table.attendeeId),
    // Registration counts and lists filter by event and status.
    index("event_registrations_event_status_idx").on(table.eventId, table.status),
  ]
);

export const vipRegistrationChange = pgEnum("vip_registration_change", ["added", "removed"]);

/**
 * PTR-111 AC5 and AC6: who added or removed each VIP registration, and when. Keep this history
 * append-only because the registration row stores only its current state. Store ids as snapshots,
 * as in `eventAssignments`, so account deletion keeps the record.
 */
export const vipRegistrationChanges = pgTable(
  "vip_registration_changes",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    attendeeId: text("attendee_id").notNull(),
    change: vipRegistrationChange("change").notNull(),
    actorId: text("actor_id").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index("vip_registration_changes_event_id_idx").on(table.eventId)]
);

/**
 * PTR-55: notifications for a user and the queue for their email copies. Insert a row in the same
 * transaction as its state change, so a rollback removes both. `kind` selects the email template.
 * `payload` stores domain data for the inbox line and email, not template props. The enum also
 * appears in `src/features/notifications/message.ts`; `db-schema.test.ts` keeps both in sync.
 */
export const notificationKind = pgEnum("notification_kind", [
  "venue_booking_requested",
  "venue_booking_approved",
  "venue_booking_rejected",
  "venue_booking_changed",
  "clarification_requested",
  "clarification_replied",
  "event_change_requested",
  "handover_requested",
  "handover_accepted",
  "handover_declined",
  "event_decided",
  "event_confirmed",
  "equipment_requested",
  "equipment_arrangements_completed",
  "equipment_unavailable",
  "equipment_released",
  "event_registered",
  "registration_threshold_reached",
  "event_cancellation_requested",
  "event_cancelled",
  "event_cancellation_declined",
  /** PTR-47 AC4: a withdrawal freed a place from an event at its registration capacity. */
  "registration_place_freed",
  /** PTR-49 AC1: a confirmed event's registration period opened. */
  "registration_opened",
  /** PTR-49 AC2: a confirmed event's registration period closed. */
  "registration_closed",
  /** PTR-23 AC5: a significant change was saved to an event with the recipient's arrangement. */
  "event_significant_change",
  /** PTR-52 AC5: the Coordinator applied or declined the Organiser's change request. */
  "event_change_processed",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The event request for this notification. Every current kind has one. */
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    payload: jsonb("payload").$type<NotificationPayload["payload"]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while unread. Set once, when first marked as read. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Null until the worker sends the email. The inbox does not depend on this field. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** Set when the worker reaches its attempt limit. The row stays in the inbox. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    emailAttempts: integer("email_attempts").notNull().default(0),
    /** When a worker can claim the row. A failure delays the next attempt. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** Lease: set while a worker owns the row, so another run does not send the email twice. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Store only the sanitized failure name because provider messages can include recipient addresses. */
    lastEmailError: text("last_email_error"),
  },
  table => [
    // The inbox reads each recipient's rows newest first. PostgreSQL scans a btree backward, so
    // ascending columns support this descending read.
    index("notifications_recipient_created_at_idx").on(
      table.recipientId,
      table.createdAt,
      table.id
    ),
    // The unread count and mark-read scan filter by recipient and unread state. The partial
    // predicate keeps this index to unread rows.
    index("notifications_unread_recipient_idx")
      .on(table.recipientId)
      .where(sql`${table.readAt} is null`),
    // The worker scans pending rows oldest first. The partial predicate keeps this index small.
    index("notifications_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.emailedAt} is null and ${table.failedAt} is null`),
    // Both the event-request read and the foreign-key cascade look up the event.
    index("notifications_event_request_id_idx").on(table.eventRequestId),
  ]
);
