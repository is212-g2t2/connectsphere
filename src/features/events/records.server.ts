import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { db as Db } from "#/db";
import { equipmentRequests, eventRegistrations, eventRequests, venueRequests } from "#/db/schema";
import { RoleSchema } from "#/features/auth/schema/role";
import { AuthorizationError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { getEventAccess, isRegistrationWindowOpen, projectEvent } from "#/features/events/access";
import type { EventProjection } from "#/features/events/access";
import { parseEventListInput } from "#/features/events/schema";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach. `server-fns.ts`
 * reaches this through a dynamic `import()` inside `.handler()`.
 *
 * The middleware pipeline has already verified the session before this runs. Which events a
 * caller is connected to is data rather than a role permission, so the scoping lives here and in
 * `access.ts`, not in a `requirePermission`.
 */

type Database = typeof Db;

export async function handleListEvents(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventProjection[]> {
  const { eventId } = parseEventListInput(data);
  const role = RoleSchema.safeParse(user.role).data ?? null;
  const now = new Date();

  // The event is the event request (PTR-21/24's event record replaces this). Each role reaches
  // only the rows its relationship names, filtered in SQL: the four internal roles see every
  // non-draft status, while browsing attendees are gated on `submitted` as the stand-in for
  // PTR-44's `confirmed` (PTR-8), and an existing registration keeps a non-draft event visible.
  const visible = ne(eventRequests.status, "draft");
  const attendeeVisible = eq(eventRequests.status, "submitted");
  let relationship: SQL | undefined;
  switch (role) {
    case "event_organiser":
      relationship = and(visible, eq(eventRequests.organiserId, user.id));
      break;
    case "event_coordinator":
      relationship = and(visible, eq(eventRequests.assignedCoordinatorId, user.id));
      break;
    case "venue_staff":
      relationship = and(
        visible,
        inArray(
          eventRequests.id,
          database
            .select({ id: venueRequests.eventId })
            .from(venueRequests)
            .where(eq(venueRequests.assignedStaffId, user.id))
        )
      );
      break;
    case "technical_support_staff":
      relationship = and(
        visible,
        inArray(
          eventRequests.id,
          database
            .select({ id: equipmentRequests.eventId })
            .from(equipmentRequests)
            .where(eq(equipmentRequests.assignedStaffId, user.id))
        )
      );
      break;
    case "attendee":
      relationship = or(
        and(attendeeVisible, eq(eventRequests.registrationEnabled, true)),
        and(
          visible,
          inArray(
            eventRequests.id,
            database
              .select({ id: eventRegistrations.eventId })
              .from(eventRegistrations)
              .where(eq(eventRegistrations.attendeeId, user.id))
          )
        )
      );
      break;
    default:
      // An unknown or missing role is granted nothing rather than everything.
      relationship = undefined;
  }

  const requestRows =
    relationship === undefined
      ? []
      : await database
          .select()
          .from(eventRequests)
          .where(
            eventId === undefined ? relationship : and(relationship, eq(eventRequests.id, eventId))
          );

  // Naming one event means a refusal rather than an empty answer, and a row that does not exist
  // is refused the same way as one belonging to someone else — neither says whether it exists,
  // and the message carries no event data (PTR-8 criterion 5).
  if (requestRows.length === 0) {
    if (eventId !== undefined) throw new AuthorizationError("Forbidden");
    return [];
  }

  const requestIds = requestRows.map(row => row.id);
  const [venueRows, equipmentRows, registrationRows] = await Promise.all([
    database
      .select()
      .from(venueRequests)
      .where(inArray(venueRequests.eventId, requestIds))
      .orderBy(venueRequests.id),
    database
      .select()
      .from(equipmentRequests)
      .where(inArray(equipmentRequests.eventId, requestIds))
      .orderBy(equipmentRequests.id),
    database
      .select()
      .from(eventRegistrations)
      .where(
        and(
          inArray(eventRegistrations.eventId, requestIds),
          eq(eventRegistrations.attendeeId, user.id)
        )
      ),
  ]);

  return requestRows.flatMap(record => {
    const ownRegistration = registrationRows.find(row => row.eventId === record.id) ?? null;

    const access = getEventAccess({
      role,
      userId: user.id,
      organiserId: record.organiserId,
      assignedCoordinatorId: record.assignedCoordinatorId,
      venueStaffIds: venueRows.flatMap(row =>
        row.eventId === record.id && row.assignedStaffId ? [row.assignedStaffId] : []
      ),
      technicalSupportIds: equipmentRows.flatMap(row =>
        row.eventId === record.id && row.assignedStaffId ? [row.assignedStaffId] : []
      ),
      isRegistrationWindowOpen: isRegistrationWindowOpen(record, now),
      hasOwnRegistration: ownRegistration !== null,
    });

    if (!access) return [];

    // Every equipment line of an event the caller is connected to, not only the lines assigned
    // to them: PTR-39 AC2 shows Technical Support the whole request.
    const equipment = equipmentRows
      .filter(row => row.eventId === record.id)
      .map(row => ({
        id: row.id,
        item: row.item,
        arrangementStatus: row.arrangementStatus,
        notes: row.notes,
      }));
    const venueRequest =
      access === "venue_staff"
        ? (venueRows.find(row => row.eventId === record.id && row.assignedStaffId === user.id) ??
          null)
        : (venueRows.find(row => row.eventId === record.id) ?? null);

    return [
      projectEvent(
        // Only the request's name differs from the projection's field name; `projectEvent`
        // lists its output field by field, so no other column of the row can reach a client.
        { ...record, name: record.eventName },
        access,
        ownRegistration
          ? {
              status: ownRegistration.status,
              registeredAt: ownRegistration.registeredAt.toISOString(),
            }
          : null,
        equipment,
        venueRequest ? { status: venueRequest.status } : null
      ),
    ];
  });
}
