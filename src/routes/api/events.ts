import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

import { getEventAccess, projectEvent } from "#/features/events/access";
import { auth } from "#/lib/auth.server";

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: async () => {
        const request = getRequest();
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const [{ db }, schema] = await Promise.all([import("#/db"), import("#/db/schema")]);
        const eventId = new URL(request.url).searchParams.get("eventId");
        const [eventRows, coordinatorRows, venueRows, equipmentRows, registrationRows] =
          await Promise.all([
            db.select().from(schema.events),
            db.select().from(schema.eventCoordinators),
            db.select().from(schema.venueRequests),
            db.select().from(schema.equipmentRequests),
            db.select().from(schema.eventRegistrations),
          ]);

        const results = eventRows.flatMap(event => {
          if (eventId && event.id !== eventId) return [];

          const ownRegistration = registrationRows.find(
            row => row.eventId === event.id && row.attendeeId === session.user.id
          );

          const access = getEventAccess({
            role: session.user.role,
            userId: session.user.id,
            createdById: event.createdById,
            coordinatorIds: coordinatorRows
              .filter(row => row.eventId === event.id)
              .map(row => row.coordinatorId),
            venueStaffIds: venueRows.flatMap(row =>
              row.eventId === event.id && row.assignedStaffId ? [row.assignedStaffId] : []
            ),
            technicalSupportIds: equipmentRows.flatMap(row =>
              row.eventId === event.id && row.assignedStaffId ? [row.assignedStaffId] : []
            ),
            isPublishedForRegistration: event.status === "confirmed" && event.registrationEnabled,
            hasOwnRegistration: Boolean(ownRegistration),
          });

          if (!access) return [];

          const equipment = equipmentRows
            .filter(row => row.eventId === event.id)
            .map(row => ({
              item: row.item,
              arrangementStatus: row.arrangementStatus,
              notes: row.notes,
            }));
          const venueRequest = venueRows.find(row => row.eventId === event.id);

          return [
            projectEvent(
              {
                id: event.id,
                name: event.name,
                description: event.description,
                eventDate: event.eventDate,
                startTime: event.startTime,
                endTime: event.endTime,
                venue: event.venue,
                status: event.status,
                registrationOpensAt: iso(event.registrationOpensAt),
                registrationClosesAt: iso(event.registrationClosesAt),
                expectedAttendance: event.expectedAttendance,
                layout: event.layout,
                accessibilityRequirements: event.accessibilityRequirements,
                requiredFacilities: event.requiredFacilities,
              },
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

        if (eventId && results.length === 0) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        return Response.json({ events: results });
      },
    },
  },
});
