import { createFileRoute } from "@tanstack/react-router";
import { AuthorizationError, getSessionUser, requirePermission } from "#/features/auth/session";

export const Route = createFileRoute("/api/venue-availability/venues")({
  server: {
    handlers: {
      GET: async () => {
        const [{ getRequest }, { auth }] = await Promise.all([
          import("@tanstack/react-start/server"),
          import("#/lib/auth"),
        ]);
        const headers = { "Cache-Control": "private, no-store" };
        const session = await auth.api.getSession({ headers: getRequest().headers });
        try {
          requirePermission(getSessionUser(session), { venueAvailability: ["read"] });
        } catch (error) {
          if (error instanceof AuthorizationError)
            return Response.json({ error: error.message }, { status: error.status, headers });
          throw error;
        }
        try {
          // Keep the database import inside the handler: this route is also represented in the
          // client route tree, while Bun's SQL driver must remain server-only.
          const [{ db }, { venues }] = await Promise.all([import("#/db"), import("#/db/schema")]);
          const rows = await db
            .select({ id: venues.id, name: venues.name })
            .from(venues)
            .orderBy(venues.name);
          return Response.json(
            rows.map(venue => ({ id: String(venue.id), name: venue.name })),
            { status: 200, headers }
          );
        } catch {
          return Response.json(
            { error: "Venue availability could not be loaded." },
            { status: 500, headers }
          );
        }
      },
    },
  },
});
