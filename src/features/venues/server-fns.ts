import { createServerFn } from "@tanstack/react-start";

import { AuthorizationError, getCurrentUser, NotFoundError } from "#/features/auth/session";
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

/**
 * Rethrows a status-carrying error as a `Response`, which TanStack Start serves verbatim — that
 * is how a direct HTTP call gets the real 401/403/404 rather than a generic failure. Anything
 * else is a genuine fault and keeps travelling as an error.
 */
function refuseAsResponse(error: unknown): never {
  if (error instanceof AuthorizationError || error instanceof NotFoundError) {
    throw new Response(error.message, { status: error.status });
  }
  throw error;
}

/**
 * All three handlers want the same session, database and record module, and the same conversion
 * on the way out, so both live here once. The load stays outside the `try`: failing to import
 * the database is a fault, not a refusal, and must not be dressed up as a status.
 */
async function withServer<T>(
  run: (...loaded: Awaited<ReturnType<typeof loadServer>>) => Promise<T>
): Promise<T> {
  const loaded = await loadServer();
  try {
    return await run(...loaded);
  } catch (error) {
    return refuseAsResponse(error);
  }
}

export const listVenues = createServerFn({ method: "GET" }).handler(async () =>
  withServer((user, { db }, { handleListVenues }) => handleListVenues(user, db))
);

/**
 * Wrapped in an object on purpose: a server function whose result is `Venue | null` infers as
 * `never` under @tanstack/react-start 1.168 (a nullable top-level result collapses), so the
 * loader could not read `venue.name`. `{ venue }` keeps the type intact.
 */
export const getVenue = createServerFn({ method: "GET" })
  .validator(parseVenueId)
  .handler(async ({ data }) =>
    withServer(async (user, { db }, { handleGetVenue }) => ({
      venue: await handleGetVenue(data, user, db),
    }))
  );

export const saveVenue = createServerFn({ method: "POST" })
  .validator(parseVenueInput)
  .handler(async ({ data }) =>
    withServer((user, { db }, { handleSaveVenue }) => handleSaveVenue(data, user, db))
  );
