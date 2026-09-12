import { createServerFn } from "@tanstack/react-start";

import { AuthorizationError, getCurrentUser } from "#/features/auth/session";
import { parseVenueId, parseVenueInput } from "#/features/venues/schema";

/**
 * Routes import this module, so it stays free of any static server import — `./records.server`
 * and `#/db` are reached inside the handlers, which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([
    getCurrentUser(),
    import("#/db"),
    import("#/features/venues/records.server"),
  ]);
}

/** A venue row as the client sees it — derived here so no route has to import the server module. */
export type Venue = Awaited<ReturnType<typeof listVenues>>[number];

function asResponse(error: unknown): never {
  if (error instanceof AuthorizationError) {
    throw new Response(error.message, { status: error.status });
  }
  throw error;
}

export const listVenues = createServerFn({ method: "GET" }).handler(async () => {
  const [user, { db }, { handleListVenues }] = await loadServer();
  try {
    return await handleListVenues(user, db);
  } catch (error) {
    return asResponse(error);
  }
});

/**
 * Wrapped in an object on purpose: a server function whose result is `Venue | null` infers as
 * `never` under @tanstack/react-start 1.168 (a nullable top-level result collapses), so the
 * loader could not read `venue.name`. `{ venue }` keeps the type intact.
 */
export const getVenue = createServerFn({ method: "GET" })
  .validator(parseVenueId)
  .handler(async ({ data }) => {
    const [user, { db }, { handleGetVenue }] = await loadServer();
    try {
      return { venue: await handleGetVenue(data, user, db) };
    } catch (error) {
      return asResponse(error);
    }
  });

export const saveVenue = createServerFn({ method: "POST" })
  .validator(parseVenueInput)
  .handler(async ({ data }) => {
    const [user, { db }, { handleSaveVenue }] = await loadServer();
    try {
      return await handleSaveVenue(data, user, db);
    } catch (error) {
      return asResponse(error);
    }
  });
