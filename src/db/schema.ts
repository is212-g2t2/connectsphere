import { sql } from "drizzle-orm";
import {
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
 * (PTR-9 criterion 2). Widening this is a generated `ALTER TYPE` migration, matching how the
 * role/function matrix grows a row at a time.
 */
export const eventRequestStatus = pgEnum("event_request_status", ["draft"]);

export const eventRequests = pgTable("event_requests", {
  id: serial("id").primaryKey(),
  organiserId: text("organiser_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  status: eventRequestStatus("status").notNull().default("draft"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date()),
});

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
