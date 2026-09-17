import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseAvailabilityRequest, parseVenueId, parseVenueInput } from "#/features/venues/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("venues");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./records.server` and `#/db` are reached inside the handlers,
 * which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/venues/records.server")]);
}

/** A venue row as the client sees it — derived here so no route has to import the server module. */
export type Venue = Awaited<ReturnType<typeof listVenues>>[number];

/** `saveVenue` is a create or an update depending on whether the payload carries an id. */
function venueAction(data: unknown): "create" | "update" {
  return typeof data === "object" && data !== null && "id" in data && data.id !== undefined
    ? "update"
    : "create";
}

export const requireVenueRead = requirePermission({ venue: ["read"] });
export const requireVenueWrite = requirePermission(data => ({ venue: [venueAction(data)] }));

export const listVenues = createServerFn({ method: "GET" })
  .middleware([requireVenueRead])
  .handler(async () => {
    const [{ db }, { handleListVenues }] = await loadServer();
    return handleListVenues(db);
  });

/**
 * Wrapped in an object on purpose: a server function whose result is `Venue | null` infers as
 * `never` under @tanstack/react-start 1.168 (a nullable top-level result collapses), so the
 * loader could not read `venue.name`. `{ venue }` keeps the type intact.
 */
export const getVenue = createServerFn({ method: "GET" })
  .validator(parseVenueId)
  .middleware([requireVenueRead])
  .handler(async ({ data }) => {
    const [{ db }, { handleGetVenue }] = await loadServer();
    return { venue: await handleGetVenue(data, db) };
  });

export const saveVenue = createServerFn({ method: "POST" })
  .validator(parseVenueInput)
  .middleware([requireVenueWrite])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveVenue }] = await loadServer();
    const venue = await handleSaveVenue(data, db);

    log.info(venueAction(data) === "create" ? "Venue created" : "Venue updated", {
      venueId: venue.id,
      name: venue.name,
      actorId: context.user.id,
    });

    return venue;
  });

/**
 * The availability calendar's read (PTR-28). Anyone holding `venue:read` may call it — the same
 * Coordinators, Venue Staff and Technical Support Staff who may read a venue record, and nobody
 * external, which is criterion 5 enforced at the addressable endpoint rather than by the guard.
 *
 * Wrapped in `{ availability }` for the reason `getVenue` documents above: a nullable top-level result infers as `never`. A venue that is not there answers `null`, and the route turns that into the router's `notFound()`.
 */
export const getVenueAvailability = createServerFn({ method: "GET" })
  .validator(parseAvailabilityRequest)
  .middleware([requireVenueRead])
  .handler(async ({ data }) => {
    const [{ db }, { handleGetVenueAvailability }] = await loadServer();
    return { availability: await handleGetVenueAvailability(data, db) };
  });

/** The calendar schedule as the client sees it — derived here, like `Venue` above. */
export type VenueAvailability = NonNullable<
  Awaited<ReturnType<typeof getVenueAvailability>>["availability"]
>;
