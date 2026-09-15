import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import type { OperatingHours, VenueLayout } from "#/features/venues/schema";

import { user } from "./auth-schema";

/**
 * Only the statuses the stories have built, so a typo'd value cannot reach the column
 * (PTR-9 criterion 2). `submitted` arrives with PTR-13; the rest of PTR-21's set (under review,
 * approved, …) arrives with the stories that move a request into them. Widening this is a
 * generated `ALTER TYPE` migration, matching how the role/function matrix grows a row at a time.
 */
export const eventRequestStatus = pgEnum("event_request_status", ["draft", "submitted"]);

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
     * than cascade: deleting a staff account must not delete the events they were handling.
     */
    assignedCoordinatorId: text("assigned_coordinator_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
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
    // PTR-15: an assignment is a Coordinator and a time together, and a draft never has one.
    check(
      "event_requests_assignment_time_matches_coordinator",
      sql`(${table.assignedCoordinatorId} is null) = (${table.assignedAt} is null)`
    ),
    check(
      "event_requests_draft_has_no_coordinator",
      sql`${table.status} <> 'draft' or ${table.assignedCoordinatorId} is null`
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
