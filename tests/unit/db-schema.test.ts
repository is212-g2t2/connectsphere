import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  extractTablesRelationalConfig,
  createTableRelationsHelpers,
  getTableColumns,
} from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "#/db/schema";
import { EVENT_REQUEST_STATUSES } from "#/features/event-requests/schema";
import { NOTIFICATION_KINDS } from "#/features/notifications/message";
import { SAFETY_REVIEW_STATES } from "#/features/safety-reviews/schema";
import {
  user,
  session,
  account,
  verification,
  userRelations,
  sessionRelations,
  accountRelations,
  venues,
  venueUnavailability,
  equipmentTypes,
  equipmentUnavailability,
  equipmentRequests,
  equipmentReservations,
  venueRequests,
  eventRequests,
} from "#/db/schema";

/** List the `onDelete` actions of the foreign keys from `table` to `equipment_types`. */
function onDeleteTowardEquipmentTypes(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table)
    .foreignKeys.filter(
      fk =>
        getTableConfig(fk.reference().foreignTable as typeof equipmentTypes).name ===
        "equipment_types"
    )
    .map(fk => fk.onDelete);
}

describe("Database Schema Definitions", () => {
  it("defines auth schema tables and column names", () => {
    expect(getTableColumns(user).email.name).toBe("email");
    expect(getTableColumns(user).role.name).toBe("role");
    expect(getTableColumns(session).token.name).toBe("token");
    expect(getTableColumns(account).providerId.name).toBe("provider_id");
    expect(getTableColumns(verification).identifier.name).toBe("identifier");
  });

  it("keeps the client-safe status list identical to the Postgres enum (PTR-14)", () => {
    expect([...schema.eventRequestStatus.enumValues]).toEqual([...EVENT_REQUEST_STATUSES]);
  });

  it("gives a registration exactly three states (PTR-45 AC4, PTR-163)", () => {
    expect([...schema.eventRegistrationStatus.enumValues]).toEqual([
      "registered",
      "withdrawn",
      "waitlisted",
    ]);
  });

  it("keeps the notification kind list identical to the Postgres enum (PTR-55)", () => {
    expect([...schema.notificationKind.enumValues]).toEqual([...NOTIFICATION_KINDS]);
  });

  it("defines the safety review table, its states and its one-pending-review index (PTR-146)", () => {
    expect([...schema.safetyReviewState.enumValues]).toEqual([...SAFETY_REVIEW_STATES]);
    const columns = getTableColumns(schema.safetyReviews);
    expect(columns.eventRequestId.name).toBe("event_request_id");
    expect(columns.fingerprint.name).toBe("fingerprint");
    expect(columns.comments.name).toBe("comments");
    expect(columns.decidedById.name).toBe("decided_by_id");
    expect(columns.decidedByName.name).toBe("decided_by_name");
    expect(columns.decidedAt.name).toBe("decided_at");
    expect(columns.createdAt.name).toBe("created_at");
    const config = getTableConfig(schema.safetyReviews);
    const checks = config.checks.map(check => check.name);
    expect(checks).toContain("safety_reviews_decision_complete");
    expect(checks).toContain("safety_reviews_comments_match_state");
    const pending = config.indexes.find(
      index => index.config.name === "safety_reviews_pending_event_idx"
    );
    expect(pending?.config.unique).toBe(true);
    const predicate = inspect(pending?.config.where, { depth: 10 });
    expect(predicate).toMatch(/pending/);
  });

  it("defines the notification queue columns (PTR-55)", () => {
    const columns = getTableColumns(schema.notifications);
    expect(columns.recipientId.name).toBe("recipient_id");
    expect(columns.eventRequestId.name).toBe("event_request_id");
    expect(columns.kind.name).toBe("kind");
    expect(columns.payload.name).toBe("payload");
    expect(columns.createdAt.name).toBe("created_at");
    expect(columns.emailedAt.name).toBe("emailed_at");
    expect(columns.failedAt.name).toBe("failed_at");
    expect(columns.emailAttempts.name).toBe("email_attempts");
    expect(columns.nextAttemptAt.name).toBe("next_attempt_at");
    expect(columns.claimedAt.name).toBe("claimed_at");
    expect(columns.lastEmailError.name).toBe("last_email_error");
    expect(columns.recipientId.notNull).toBe(true);
    expect(columns.eventRequestId.notNull).toBe(true);
  });

  it("defines the venue catalogue tables with their column names (PTR-26)", () => {
    expect(getTableColumns(venues).maxCapacity.name).toBe("max_capacity");
    expect(getTableColumns(venues).operatingHours.name).toBe("operating_hours");
    expect(getTableColumns(venues).supportedLayouts.name).toBe("supported_layouts");
    expect(getTableColumns(venueUnavailability).venueId.name).toBe("venue_id");
    expect(getTableColumns(venueUnavailability).startsAt.name).toBe("starts_at");
  });

  it("lets a venue block stay open until lifted (PTR-136)", () => {
    const columns = getTableColumns(venueUnavailability);
    expect(columns.endsAt.notNull).toBe(false);
    expect(columns.createdById.name).toBe("created_by_id");
    expect(columns.liftedAt.name).toBe("lifted_at");
    expect(columns.liftedById.name).toBe("lifted_by_id");
    const period = getTableConfig(venueUnavailability).indexes.find(
      index => index.config.name === "venue_unavailability_period_idx"
    );
    const predicate = inspect(period?.config.where, { depth: 10 });
    expect(predicate).toMatch(/lifted_at/);
    expect(predicate).toMatch(/is null/i);
  });

  it("defines the equipment inventory tables (PTR-115, PTR-41)", () => {
    expect(getTableColumns(equipmentTypes).quantityHeld.name).toBe("quantity_held");
    expect(getTableColumns(equipmentUnavailability).equipmentTypeId.name).toBe("equipment_type_id");
    expect(getTableColumns(equipmentUnavailability).quantityUnavailable.name).toBe(
      "quantity_unavailable"
    );
    expect(getTableColumns(equipmentRequests).quantity.name).toBe("quantity");
    expect(getTableColumns(equipmentRequests).equipmentTypeId.name).toBe("equipment_type_id");
    expect(getTableColumns(equipmentReservations).quantity.name).toBe("quantity");
    expect(getTableColumns(equipmentReservations).equipmentRequestId.name).toBe(
      "equipment_request_id"
    );
    expect(getTableColumns(equipmentReservations).equipmentTypeId.name).toBe("equipment_type_id");
  });

  it("restricts type deletion while a line or reservation references it, and cascades out-of-service rows (PTR-162 AC4)", () => {
    // A type is available to events at every venue (PTR-162 AC6): no venue column may appear here.
    expect(Object.keys(getTableColumns(equipmentTypes)).toSorted()).toEqual([
      "createdAt",
      "id",
      "name",
      "quantityHeld",
    ]);
    expect(onDeleteTowardEquipmentTypes(equipmentRequests)).toEqual(["restrict"]);
    expect(onDeleteTowardEquipmentTypes(equipmentReservations)).toEqual(["restrict"]);
    expect(onDeleteTowardEquipmentTypes(equipmentUnavailability)).toEqual(["cascade"]);
  });

  it("snapshots the reservation period on the reservation (PTR-41)", () => {
    const columns = getTableColumns(equipmentReservations);
    expect(columns.startsAt.name).toBe("starts_at");
    expect(columns.endsAt.name).toBe("ends_at");
    expect(columns.startsAt.notNull).toBe(true);
    expect(columns.endsAt.notNull).toBe(true);
  });

  it("defines the event request registration columns (PTR-11)", () => {
    expect(getTableColumns(eventRequests).registrationEnabled.name).toBe("registration_enabled");
    expect(getTableColumns(eventRequests).registrationCapacity.name).toBe("registration_capacity");
    expect(getTableColumns(eventRequests).registrationOpensAt.name).toBe("registration_opens_at");
    expect(getTableColumns(eventRequests).registrationClosesAt.name).toBe("registration_closes_at");
  });

  it("defines the venue request columns (PTR-31)", () => {
    expect(getTableColumns(venueRequests).venueId.name).toBe("venue_id");
    expect(getTableColumns(venueRequests).requestedById.name).toBe("requested_by_id");
    // Use nullable `set null`, as with `assignedCoordinatorId`. Deleting a staff account deletes
    // no raised request.
    expect(getTableColumns(venueRequests).requestedById.notNull).toBe(false);
    expect(getTableColumns(venueRequests).startsAt.name).toBe("starts_at");
    expect(getTableColumns(venueRequests).endsAt.name).toBe("ends_at");
    expect(getTableColumns(venueRequests).createdAt.name).toBe("created_at");
  });

  it("defines the draft attachment columns, size checks, and event index", () => {
    const columns = getTableColumns(schema.eventRequestAttachments);
    expect(columns.eventRequestId.name).toBe("event_request_id");
    expect(columns.eventRequestId.notNull).toBe(true);
    expect(columns.objectKey.name).toBe("object_key");
    expect(columns.originalFilename.name).toBe("original_filename");
    expect(columns.contentType.name).toBe("content_type");
    expect(columns.sizeBytes.name).toBe("size_bytes");
    expect(columns.uploadedById.name).toBe("uploaded_by_id");
    expect(columns.uploadedById.notNull).toBe(false);
    const config = getTableConfig(schema.eventRequestAttachments);
    expect(config.checks.map(check => check.name)).toContain(
      "event_request_attachments_size_positive"
    );
    expect(config.checks.map(check => check.name)).toContain(
      "event_request_attachments_size_limit"
    );
    expect(
      config.indexes.some(
        index => index.config.name === "event_request_attachments_event_request_id_idx"
      )
    ).toBe(true);
  });

  it("defines the venue hold columns and status enum (PTR-109)", () => {
    expect([...schema.venueHoldStatus.enumValues]).toEqual([
      "held",
      "released",
      "expired",
      "requested",
      "declined",
    ]);
    const columns = getTableColumns(schema.venueHolds);
    expect(columns.eventId.name).toBe("event_id");
    expect(columns.venueId.name).toBe("venue_id");
    expect(columns.startsAt.name).toBe("starts_at");
    expect(columns.endsAt.name).toBe("ends_at");
    expect(columns.status.name).toBe("status");
    expect(columns.heldById.name).toBe("held_by_id");
    expect(columns.heldById.notNull).toBe(false);
    expect(columns.releasedById.name).toBe("released_by_id");
    expect(columns.releasedById.notNull).toBe(false);
    // PTR-142: a hold can have no expiry or warning, and it records the latest expiry change.
    expect(columns.expiresAt.name).toBe("expires_at");
    expect(columns.expiresAt.notNull).toBe(false);
    expect(columns.warnAt.name).toBe("warn_at");
    expect(columns.warnAt.notNull).toBe(false);
    expect(columns.expiryChangedById.name).toBe("expiry_changed_by_id");
    expect(columns.expiryChangedAt.name).toBe("expiry_changed_at");
    expect(getTableConfig(schema.venueHolds).checks.map(check => check.name)).toContain(
      "venue_holds_warn_before_expiry"
    );
    // PTR-150: the Venue Staff member who placed or declined a hold request, and the reason.
    expect(columns.placedById.name).toBe("placed_by_id");
    expect(columns.declinedById.name).toBe("declined_by_id");
    expect(columns.declineReason.name).toBe("decline_reason");
    expect(getTableConfig(schema.venueHolds).checks.map(check => check.name)).toContain(
      "venue_holds_decline_reason_matches_status"
    );
  });

  it("defines the venue occupancy ledger columns (PTR-133)", () => {
    const columns = getTableColumns(schema.venueOccupancy);
    // A block row belongs to no event.
    expect(columns.eventId.notNull).toBe(false);
    expect(columns.venueUnavailabilityId.name).toBe("venue_unavailability_id");
    expect(columns.active.notNull).toBe(true);
    // PTR-136: only a block row may leave the end open.
    expect(columns.endsAt.notNull).toBe(false);
    const checks = getTableConfig(schema.venueOccupancy).checks.map(check => check.name);
    expect(checks).toContain("venue_occupancy_unbounded_only_for_block");
  });

  it("keeps the venue request status list identical to the Postgres enum (PTR-31, PTR-36, PTR-34)", () => {
    expect([...schema.venueRequestStatus.enumValues]).toEqual([
      "pending",
      "withdrawn",
      "approved",
      "rejected",
      "released",
    ]);
  });

  it("records a replacement chain and a dismissal on the venue request (PTR-165)", () => {
    const columns = getTableColumns(venueRequests);
    expect(columns.replacesRequestId.name).toBe("replaces_request_id");
    expect(columns.dismissedAt.name).toBe("dismissed_at");
    expect(columns.dismissedById.name).toBe("dismissed_by_id");
    for (const column of [columns.replacesRequestId, columns.dismissedAt, columns.dismissedById]) {
      expect(column.notNull).toBe(false);
    }
    // AC6: one replacement that is not withdrawn per request, so every chain has one end.
    const replacement = getTableConfig(venueRequests).indexes.find(
      index => index.config.name === "venue_requests_replaces_request_id_idx"
    );
    expect(replacement?.config.unique).toBe(true);
    expect(inspect(replacement?.config.where, { depth: 10 })).toMatch(/withdrawn/);
    // AC4: only a settled request can be dismissed, and a later withdrawal keeps the history.
    // Assert the predicate, not only the name: widening it would void the invariant.
    const dismissal = getTableConfig(venueRequests).checks.find(
      check => check.name === "venue_requests_dismissal_settled"
    );
    if (!dismissal) throw new Error("venue_requests_dismissal_settled is missing");
    const rendered = new PgDialect().sqlToQuery(dismissal.value).sql;
    expect(rendered).toContain("'rejected'");
    expect(rendered).toContain("'released'");
    expect(rendered).toContain("'withdrawn'");
    expect(rendered).not.toContain("'pending'");
  });

  it("records a rejection's reason and optional suggestion on the venue request (PTR-34)", () => {
    const columns = getTableColumns(venueRequests);
    expect(columns.rejectionReason.name).toBe("rejection_reason");
    expect(columns.suggestedVenueId.name).toBe("suggested_venue_id");
    expect(columns.suggestedDate.name).toBe("suggested_date");
    expect(columns.suggestedStartTime.name).toBe("suggested_start_time");
    expect(columns.suggestedEndTime.name).toBe("suggested_end_time");
    // Only a rejection carries these columns. All stay nullable.
    for (const column of [
      columns.rejectionReason,
      columns.suggestedVenueId,
      columns.suggestedDate,
      columns.suggestedStartTime,
      columns.suggestedEndTime,
    ]) {
      expect(column.notNull).toBe(false);
    }
  });

  it("records a release reason and durable actor label (PTR-37)", () => {
    const columns = getTableColumns(venueRequests);
    expect(columns.releaseReason.name).toBe("release_reason");
    expect(columns.lastChangedByStaffId.name).toBe("last_changed_by_staff_id");
    expect(columns.lastChangedByStaffName.name).toBe("last_changed_by_staff_name");
    expect(columns.lastChangedAt.name).toBe("last_changed_at");
  });

  it("defines the event request assignment columns (PTR-15)", () => {
    expect(getTableColumns(eventRequests).assignedCoordinatorId.name).toBe(
      "assigned_coordinator_id"
    );
    expect(getTableColumns(eventRequests).assignedAt.name).toBe("assigned_at");
  });

  it("defines the event request submission column (PTR-13)", () => {
    expect(getTableColumns(eventRequests).submittedAt.name).toBe("submitted_at");
  });

  it("defines the recorded decision columns (PTR-20)", () => {
    expect(getTableColumns(eventRequests).decisionReason.name).toBe("decision_reason");
    expect(getTableColumns(eventRequests).decidedByCoordinatorId.name).toBe(
      "decided_by_coordinator_id"
    );
    expect(getTableColumns(eventRequests).decidedByCoordinatorName.name).toBe(
      "decided_by_coordinator_name"
    );
    expect(getTableColumns(eventRequests).decidedAt.name).toBe("decided_at");
  });

  it("defines the confirmation columns and the CHECK that ties them to the status (PTR-24)", () => {
    const columns = getTableColumns(eventRequests);
    expect(columns.confirmedById.name).toBe("confirmed_by_id");
    expect(columns.confirmedByName.name).toBe("confirmed_by_name");
    expect(columns.confirmedAt.name).toBe("confirmed_at");
    const checks = getTableConfig(eventRequests).checks.map(check => check.name);
    expect(checks).toContain("event_requests_confirmation_matches_status");
  });

  it("defines the completion audit columns and status CHECK (PTR-25)", () => {
    const columns = getTableColumns(eventRequests);
    expect(columns.completedById.name).toBe("completed_by_id");
    expect(columns.completedByName.name).toBe("completed_by_name");
    expect(columns.completedAt.name).toBe("completed_at");
    const checks = getTableConfig(eventRequests).checks.map(check => check.name);
    expect(checks).toContain("event_requests_completion_matches_status");
  });

  it("defines relations between user, session, and account", () => {
    expect(userRelations.table).toBe(user);
    expect(sessionRelations.table).toBe(session);
    expect(accountRelations.table).toBe(account);
  });

  it("extracts and validates full relational schema config", () => {
    const { tables } = extractTablesRelationalConfig(schema, createTableRelationsHelpers);

    expect(tables.user).toBeDefined();
    expect(tables.session).toBeDefined();
    expect(tables.account).toBeDefined();

    expect(tables.user.relations.sessions).toBeDefined();
    expect(tables.user.relations.accounts).toBeDefined();
    expect(tables.session.relations.user).toBeDefined();
    expect(tables.account.relations.user).toBeDefined();
    expect(tables.venueRequests).toBeDefined();
    expect(tables.equipmentTypes).toBeDefined();
    expect(tables.equipmentUnavailability).toBeDefined();
    expect(tables.equipmentRequests).toBeDefined();
    expect(tables.equipmentTypes).toBeDefined();
    expect(tables.equipmentUnavailability).toBeDefined();
    expect(tables.equipmentReservations).toBeDefined();
    expect(tables.eventRegistrations).toBeDefined();
  });
});
