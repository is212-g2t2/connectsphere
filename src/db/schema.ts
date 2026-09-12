import { integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
   * A real `timestamp` so Postgres orders and indexes these itself, but in `mode: "string"`:
   * no JS `Date` is constructed on either side of the driver, so the wall-clock the organiser
   * typed cannot be shifted by the host timezone. Postgres returns it canonicalised
   * (`2026-11-18 09:30:00`), which is what a reader gets back.
   */
  proposedStart: timestamp("proposed_start", { mode: "string" }),
  proposedEnd: timestamp("proposed_end", { mode: "string" }),
  expectedAttendance: integer("expected_attendance"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date()),
});

export * from "./auth-schema";
