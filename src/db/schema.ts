import { integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import type { EventRequestDraftValues } from "#/features/event-requests/schema";

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

export * from "./auth-schema";
