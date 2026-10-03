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
 * The full defined set (PTR-21): the one place an event's stage is recorded. Only a user's status
 * action writes it — a venue or equipment arrangement changing never moves an event by itself —
 * and every decision keeps who and when (the `event_requests_decision_matches_status` CHECK). The
 * client restates the set in `src/features/event-requests/schema.ts`, held identical by
 * `tests/unit/db-schema.test.ts`; widening it is a generated `ALTER TYPE` migration.
 */
export const eventRequestStatus = pgEnum("event_request_status", [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "awaiting_organiser",
  // PTR-21 criterion 1: the rest of the defined set, added once so PTR-24 (confirmed), PTR-25
  // (completed) and PTR-54 (cancelled) write into an enum that already holds their value.
  // `planning` is the stage between approval and confirmation the brief names (§5 steps 6–9).
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
    /**
     * PTR-13 criterion 2: when the organiser submitted the request. Null while it is a draft,
     * and the CHECK below keeps any other status from existing without it.
     */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /**
     * PTR-15: the one Event Coordinator responsible for the event, chosen at submission. A single
     * column is what makes criterion 2 structural — a row cannot hold two. Null while a draft
     * (PTR-9 criterion 4), and null after submission only when no Coordinator could be assigned
     * (criterion 5), in which case the request waits in the unassigned list. `set null` rather
     * than cascade: deleting a staff account must not delete the events they were handling —
     * they become unassigned and wait to be picked up (PTR-16), and `assignedAt` is left as the
     * record of the assignment that was, which is why the CHECK below runs one way only.
     */
    assignedCoordinatorId: text("assigned_coordinator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    /** PTR-20: immutable decision attribution retained after the request leaves review. */
    decisionReason: text("decision_reason"),
    decidedByCoordinatorId: text("decided_by_coordinator_id"),
    decidedByCoordinatorName: text("decided_by_coordinator_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /**
     * PTR-24 AC4: who confirmed the event and when, kept apart from the decision columns so the
     * approval attribution survives. The id and name are snapshots, like the decision's, so an
     * account deletion keeps the record. Null until the event is confirmed.
     */
    confirmedById: text("confirmed_by_id"),
    confirmedByName: text("confirmed_by_name"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    eventName: text("event_name").notNull().default(""),
    purpose: text("purpose").notNull().default(""),
    /**
     * JSONB rather than a `timestamp` pair (PTR-10): an organiser may propose several date windows, and the strings round-trip exactly as the `datetime-local` inputs submitted them
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
     * PTR-43: when Technical Support Staff marked the equipment arrangements complete, and who did
     * it. Null until then, and cleared by any line mutation (add, edit, remove, notes, state
     * change, reservation reduce/release) so a value only survives while the arrangements it
     * describes are unchanged.
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
     * PTR-11: whether attendees may register, and the terms when they may. The two window columns
     * are text for the same reason `proposedDates` is JSONB — the `datetime-local` spelling
     * survives the round trip untouched, and the fixed-width format the save path guarantees keeps
     * the CHECK below a chronological comparison. A `timestamp` column would hand back
     * `… 18:00:00` instead.
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
    // PTR-13 criterion 2, held for whichever path writes the row: a draft has no submission time,
    // and anything past draft records the moment it left (the later statuses keep it).
    check(
      "event_requests_submission_time_matches_status",
      sql`(${table.status} = 'draft' and ${table.submittedAt} is null) or (${table.status} <> 'draft' and ${table.submittedAt} is not null)`
    ),
    // PTR-15: a Coordinator is never recorded without the time they were assigned. The reverse
    // is allowed — `ON DELETE SET NULL` vacates the Coordinator and keeps the time — so a staff
    // account with events can still be removed.
    check(
      "event_requests_coordinator_has_assignment_time",
      sql`${table.assignedCoordinatorId} is null or ${table.assignedAt} is not null`
    ),
    // PTR-9 criterion 4: a draft never carries a Coordinator. Only the id is guarded — no path
    // writes `assignedAt` on a draft — while a time without an id stays legal for the CHECK above.
    check(
      "event_requests_draft_has_no_coordinator",
      sql`${table.status} <> 'draft' or ${table.assignedCoordinatorId} is null`
    ),
    // Decision attribution is required from the moment a request is approved or rejected and is
    // kept through every later stage (planning, confirmed, completed); it must be absent before a
    // decision exists. A cancellation can happen on either side of the decision (PTR-54), so
    // `cancelled` accepts the attribution complete or wholly absent, never half-written.
    check(
      "event_requests_decision_matches_status",
      sql`(${table.status}::text in ('approved', 'rejected', 'planning', 'confirmed', 'completed') and ${table.decidedByCoordinatorId} is not null and btrim(${table.decidedByCoordinatorId}) <> '' and ${table.decidedByCoordinatorName} is not null and btrim(${table.decidedByCoordinatorName}) <> '' and ${table.decidedAt} is not null) or (${table.status}::text in ('draft', 'submitted', 'under_review', 'awaiting_organiser') and ${table.decisionReason} is null and ${table.decidedByCoordinatorId} is null and ${table.decidedByCoordinatorName} is null and ${table.decidedAt} is null) or (${table.status}::text = 'cancelled' and ((${table.decidedByCoordinatorId} is not null and btrim(${table.decidedByCoordinatorId}) <> '' and ${table.decidedByCoordinatorName} is not null and btrim(${table.decidedByCoordinatorName}) <> '' and ${table.decidedAt} is not null) or (${table.decisionReason} is null and ${table.decidedByCoordinatorId} is null and ${table.decidedByCoordinatorName} is null and ${table.decidedAt} is null)))`
    ),
    // PTR-24 AC4: a confirmed event always says who confirmed it and when; the three columns are
    // all present or all absent; and only the stages from confirmation on may carry them.
    // `completed` and `cancelled` keep the record of a confirmation they followed.
    check(
      "event_requests_confirmation_matches_status",
      sql`(${table.status}::text = 'confirmed' and ${table.confirmedById} is not null and btrim(${table.confirmedById}) <> '' and ${table.confirmedByName} is not null and btrim(${table.confirmedByName}) <> '' and ${table.confirmedAt} is not null) or (${table.status}::text in ('completed', 'cancelled') and ((${table.confirmedById} is not null and btrim(${table.confirmedById}) <> '' and ${table.confirmedByName} is not null and btrim(${table.confirmedByName}) <> '' and ${table.confirmedAt} is not null) or (${table.confirmedById} is null and ${table.confirmedByName} is null and ${table.confirmedAt} is null))) or (${table.status}::text not in ('confirmed', 'completed', 'cancelled') and ${table.confirmedById} is null and ${table.confirmedByName} is null and ${table.confirmedAt} is null)`
    ),
    check(
      "event_requests_rejection_has_reason",
      sql`${table.status}::text <> 'rejected' or (${table.decisionReason} is not null and btrim(${table.decisionReason}) <> '')`
    ),
    // Criterion 2/5, held for whichever path writes the row: terms exist exactly when enabled.
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
    // PTR-8 resolves a caller's event by ownership or assignment; both columns are looked up
    // per request, and Postgres indexes neither a foreign key nor a column on its own.
    index("event_requests_organiser_id_idx").on(table.organiserId),
    index("event_requests_assigned_coordinator_id_idx").on(table.assignedCoordinatorId),
    index("event_requests_equipment_arrangements_completed_by_id_idx").on(
      table.equipmentArrangementsCompletedById
    ),
  ]
);

/** PTR-16: append-only handover history. User ids are snapshots so account deletion keeps attribution. */
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
 * PTR-110: the decision the incoming Coordinator makes on a pending handover. The row itself is
 * the pending state — `decision` is null until answered, and the CHECK below keeps the decision
 * attribution all-or-nothing. The partial unique index allows one live handover per event, so a
 * replacement (raise again) has to resolve the previous one first.
 */
export const eventHandoverDecision = pgEnum("event_handover_decision", ["accepted", "declined"]);

export const eventHandovers = pgTable(
  "event_handovers",
  {
    id: serial("id").primaryKey(),
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    /** Snapshots, like `eventAssignments`: account deletion keeps the record attributable. */
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
    // PTR-110: one handover waits at a time; a raise replaces the previous live row in the same
    // transaction, and the index is the backstop for a writer that does not come through it.
    uniqueIndex("event_handovers_pending_event_idx")
      .on(table.eventRequestId)
      .where(sql`${table.decision} is null`),
    // The incoming Coordinator's list reads by recipient.
    index("event_handovers_to_coordinator_id_idx").on(table.toCoordinatorId),
  ]
);

/**
 * PTR-18: clarification requests raised by the assigned Coordinator. User ids are snapshots so
 * account deletion keeps attribution. The question body is immutable once recorded — the
 * Coordinator must raise a new one to add to it — while the reply columns are written once when
 * the Organiser answers.
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
     * PTR-19: what the reply changed on the request, as `{field, from, to}` entries, so both detail
     * pages can show the amendment beside the reply. Empty when the reply answered without
     * amending anything. `jsonb` keeps the before/after values exactly as the request stored them.
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

export const venues = pgTable(
  "venues",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    location: text("location").notNull(),
    // Criterion 3 lives in the database too, not only in the Zod schema: a positive whole number
    // is what `integer` plus this CHECK guarantees, whichever path writes the row.
    maxCapacity: integer("max_capacity").notNull(),
    facilities: text("facilities").array().notNull().default([]),
    accessibilityFeatures: text("accessibility_features").array().notNull().default([]),
    // Values are constrained to `VENUE_LAYOUTS` by `VenueInput`, not by a Postgres enum, so
    // widening the list is a code change rather than an `ALTER TYPE` migration.
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
 * Recorded periods a venue cannot be requested for (maintenance, renovation, internal use).
 * v0.1 defers *managing* these (brief §9), so today the rows come from the seed (PTR-59
 * criterion 4) and are read by the availability calendar (PTR-28). The `mode: "string"`
 * timestamps keep the `datetime-local` values round-tripping exactly.
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
    // What makes re-running the seed a no-op rather than a second copy of every period.
    uniqueIndex("venue_unavailability_period_idx").on(table.venueId, table.startsAt, table.endsAt),
  ]
);

export * from "./auth-schema";

/**
 * PTR-8: the statuses an event's child records can hold. Same rule as `eventRequestStatus`
 * above — only what a story writes today — so widening one is a generated `ALTER TYPE`
 * migration when PTR-34/37/39/44 start moving it. PTR-31 added `withdrawn`: a request the
 * Coordinator took back is kept rather than deleted, so the record of it survives. PTR-36
 * added `approved`: an approved request is the booking that holds the venue, and the exclusion
 * constraint in migration 0019 is label-based, not order-based. PTR-34 added `rejected`, and
 * PTR-37 added `released`; both hold nothing because the constraint only looks at `approved`.
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
 * PTR-39 added `not_required` and `unavailable`, the two states Technical Support sets by hand;
 * `reserved` stays with the reservation action (PTR-41).
 */
export const equipmentArrangementStatus = pgEnum("equipment_arrangement_status", [
  "requested",
  "reserved",
  "not_required",
  "unavailable",
]);

export const eventRegistrationStatus = pgEnum("event_registration_status", ["registered"]);

/**
 * PTR-8: until the event record arrives (PTR-21/24), the submitted event request *is* the event,
 * so every child below references `event_requests.id` rather than a parallel events table.
 * `venue_requests` and `equipment_requests` are the requests directed at Venue Staff and
 * Technical Support (PTR-8 criterion 3); PTR-31 filled the venue request's own columns.
 *
 * PTR-36: no two `approved` rows may overlap for one venue. The guarantee is the partial
 * exclusion constraint in migration `0019_booking-overlap-constraint`, which Drizzle cannot
 * express here and never drops; see docs/adrs/ADR-5-venue-booking-overlap.md.
 */
export const venueRequests = pgTable(
  "venue_requests",
  {
    id: text("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    /**
     * PTR-31 criterion 1: the venue the Coordinator chose. Deleting a venue is not a story yet,
     * so the default `no action` is the safe side of that decision.
     */
    venueId: integer("venue_id")
      .notNull()
      .references(() => venues.id),
    /**
     * PTR-31 criterion 1: the requested window, in the `mode: "string"` shape
     * `venueUnavailability` already uses, so the `datetime-local` spelling survives the round
     * trip and the CHECK below compares fixed-width strings as times. What the Coordinator
     * submits is a civil date plus a start and end time, combined into one pair here.
     */
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    /**
     * Who is working the request. Null on creation (PTR-31): the queue is shared, so a request
     * is not routed to a person — the approval records the Venue Staff member who settled it (PTR-36).
     */
    assignedStaffId: text("assigned_staff_id").references(() => user.id, { onDelete: "set null" }),
    /** PTR-37: last Venue Staff actor to release or amend this booking. */
    lastChangedByStaffId: text("last_changed_by_staff_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Durable PTR-37 actor label, retained if the staff account is later deleted. */
    lastChangedByStaffName: text("last_changed_by_staff_name"),
    /** PTR-37: when the release or amendment was committed. */
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    /**
     * PTR-31 criterion 5: the Coordinator who raised the request, snapshotted at creation. Withdraw
     * authorizes on this rather than the event's current assignee, so reassigning an event does not
     * hand another Coordinator the power to take back a request they never raised. `set null` rather
     * than cascade, matching `assignedCoordinatorId`: deleting a staff account must not delete the
     * requests they raised, including approved bookings that will hold the venue — the row stays and
     * becomes unattributable, and null reads as "not the raiser" in the withdrawal check.
     */
    requestedById: text("requested_by_id").references(() => user.id, { onDelete: "set null" }),
    status: venueRequestStatus("status").default("pending").notNull(),
    /**
     * PTR-34 criterion 1: why Venue Staff rejected it, kept on the row so the Coordinator sees it
     * whenever they view the event. The CHECK below refuses a rejected row without one.
     */
    rejectionReason: text("rejection_reason"),
    /** PTR-37: the required operational reason when an approved booking is released. */
    releaseReason: text("release_reason"),
    /**
     * PTR-34 criterion 2: the alternative Venue Staff may suggest, each part optional and
     * independent. PTR-35 pre-fills a new request from these. `set null` so a removed venue leaves
     * the rejection and its reason standing.
     */
    suggestedVenueId: integer("suggested_venue_id").references(() => venues.id, {
      onDelete: "set null",
    }),
    suggestedDate: date("suggested_date", { mode: "string" }),
    suggestedStartTime: time("suggested_start_time"),
    suggestedEndTime: time("suggested_end_time"),
    /** When the Coordinator raised it — the queue's first-come-first-served order (PTR-32). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Mirrors `venues`/`eventRequests`: the row's `status` is mutable (withdrawal), so it records
    // when it last changed.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  table => [
    // Criterion 1: a request that ends before it starts is not a request.
    check("venue_requests_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
    // PTR-34 criterion 1, held for whichever path writes the row. Compared as text: Postgres
    // refuses a value added to an enum in the same transaction, which is where this migration runs.
    // `[:space:]` catches every whitespace character (tabs and newlines included), not only the
    // plain spaces `btrim` alone would strip; the app's own Zod schema already trims and caps the
    // reason, so this is the backstop for a writer outside it.
    check(
      "venue_requests_rejection_has_reason",
      sql`${table.status}::text <> 'rejected' or coalesce(${table.rejectionReason}, '') ~ '[^[:space:]]'`
    ),
    check(
      "venue_requests_release_has_reason",
      sql`${table.status}::text <> 'released' or coalesce(${table.releaseReason}, '') ~ '[^[:space:]]'`
    ),
    // Criterion 1 again: a double-submit cannot leave two live requests for one venue on one
    // event. Partial, so withdrawing frees the pair to be requested again.
    uniqueIndex("venue_requests_pending_event_venue_idx")
      .on(table.eventId, table.venueId)
      .where(sql`${table.status} = 'pending'`),
    // Both directions are looked up per request: the caller's assignments, and the requests of
    // the events a caller can already see.
    index("venue_requests_event_id_idx").on(table.eventId),
    index("venue_requests_assigned_staff_id_idx").on(table.assignedStaffId),
    // PTR-37's shared approved-booking queue filters by status and sorts by its start time.
    index("venue_requests_approved_starts_at_idx")
      .on(table.startsAt)
      // The wrapper is IMMUTABLE and already exists for ADR-5. It also avoids PostgreSQL 15's
      // refusal to use an enum value added earlier in the same migration transaction.
      .where(sql`venue_request_occupies_venue(${table.status})`),
  ]
);

/**
 * PTR-109: tentative venue holds placed by an event's assigned Coordinator.
 * Holds reserve a venue for an event before final booking confirmation.
 * Exactly one active hold or approved booking may exist for a venue/time slot.
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
    /**
     * PTR-38 criterion 1: a positive whole number, enforced by the CHECK below so any writer
     * outside the application schema also meets the constraint.
     */
    quantity: integer("quantity").notNull(),
    arrangementStatus: equipmentArrangementStatus("arrangement_status")
      .default("requested")
      .notNull(),
    notes: text("notes"),
    /**
     * PTR-39: Technical Support's own note on the line, kept apart from the Coordinator's `notes`
     * so neither overwrites the other. Null when there is none.
     */
    arrangementNotes: text("arrangement_notes"),
    /** PTR-39 AC3: why the line is `unavailable`; null in every other state. */
    unavailableReason: text("unavailable_reason"),
    /** PTR-42: last Technical Support actor to reduce or release this line's reservation. */
    lastReleasedByStaffId: text("last_released_by_staff_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Durable PTR-42 actor label, retained if the staff account is later deleted. */
    lastReleasedByStaffName: text("last_released_by_staff_name"),
    /** PTR-42: when the reduction or release was committed. */
    lastReleasedAt: timestamp("last_released_at", { withTimezone: true }),
    /** PTR-42: units given back in the most recent reduce or release. */
    lastReleasedQuantity: integer("last_released_quantity"),
  },
  table => [
    check("equipment_requests_quantity_positive", sql`${table.quantity} > 0`),
    index("equipment_requests_event_id_idx").on(table.eventId),
    index("equipment_requests_assigned_staff_id_idx").on(table.assignedStaffId),
    index("equipment_requests_last_released_by_staff_id_idx").on(table.lastReleasedByStaffId),
    // PTR-39 AC3 backstop against a missing or whitespace-only reason. The Zod rule
    // (`requireReasonAndChange`) also rejects format/control characters such as zero-width spaces,
    // which pass this check. Compared as text: Postgres refuses to
    // use an enum value added in the same transaction, which is where this migration runs.
    // `[:space:]` catches tabs and newlines as well as plain spaces.
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

/** PTR-40: the catalogue of equipment types and how many of each the venue holds in total. */
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
 * PTR-40 AC2: units of a type recorded damaged, under maintenance or otherwise out of service.
 * One row per reason, so re-recording a reason updates it rather than double-counting.
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
 * PTR-40 read side of a reservation: units of a type committed to an event's equipment line. The
 * period is recorded at reservation time, so later booking changes do not move it. PTR-41 owns
 * the write path.
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
    // The overlap predicate filters by type and period, so the engine reads this path.
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
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    primaryKey({ columns: [table.eventId, table.attendeeId] }),
    // The primary key leads with `event_id`, so an attendee's own registrations need their own
    // path to be indexed.
    index("event_registrations_attendee_id_idx").on(table.attendeeId),
  ]
);

/**
 * PTR-55: every notification raised for one user, and the queue its email copy is delivered from.
 * A row commits in the same transaction as the state change it announces, so a rolled-back change
 * leaves nothing behind. `kind` selects the email template; `payload` carries the domain facts the
 * inbox line and the email are both built from (never template props). The list in
 * `src/features/notifications/message.ts` restates this enum, held identical by `db-schema.test.ts`.
 */
export const notificationKind = pgEnum("notification_kind", [
  "venue_booking_requested",
  "venue_booking_approved",
  "venue_booking_rejected",
  "venue_booking_changed",
  "clarification_requested",
  "clarification_replied",
  "handover_requested",
  "handover_accepted",
  "handover_declined",
  "event_decided",
  "event_confirmed",
  "equipment_requested",
  "equipment_arrangements_completed",
  "equipment_unavailable",
  "equipment_released",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The event request the notification is about; every current kind has one. */
    eventRequestId: integer("event_request_id")
      .notNull()
      .references(() => eventRequests.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    payload: jsonb("payload").$type<NotificationPayload["payload"]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null until the worker delivers the email copy; the inbox does not depend on it. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** Set when the worker gives up after its attempt budget; the row stays in the inbox. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    emailAttempts: integer("email_attempts").notNull().default(0),
    /** When a worker may claim the row; a failure pushes it out with backoff. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** Lease: set while a worker owns the row, so a second run skips it rather than double-sends. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Sanitised failure name only: provider messages can echo the recipient address. */
    lastEmailError: text("last_email_error"),
  },
  table => [
    // The inbox reads one recipient's rows newest first; Postgres scans a btree backwards, so
    // ascending columns serve the descending read.
    index("notifications_recipient_created_at_idx").on(
      table.recipientId,
      table.createdAt,
      table.id
    ),
    // The worker scans pending rows oldest first; the partial predicate keeps the queue small.
    index("notifications_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.emailedAt} is null and ${table.failedAt} is null`),
    // The event-request read path and the FK's cascade both look the event up.
    index("notifications_event_request_id_idx").on(table.eventRequestId),
  ]
);
