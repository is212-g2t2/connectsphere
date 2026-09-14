import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requirePermission } from "#/features/auth/session";
import { parseVenueId, parseVenueInput } from "#/features/venues/schema";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const WEEKDAYS_BY_SUNDAY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./records.server` and `#/db` are reached inside the handlers,
 * which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/venues/records.server")]);
}

async function logUnexpectedError(context: string, error: unknown): Promise<void> {
  const { logger } = await import("#/lib/logger");
  logger.error(`Venue ${context} failed`, { error });
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
  .handler(async ({ data }) => {
    const [{ db }, { handleSaveVenue }] = await loadServer();
    return handleSaveVenue(data, db);
  });
