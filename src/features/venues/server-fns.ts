import { createServerFn } from "@tanstack/react-start";

import { can } from "#/features/auth/permissions";
import { requirePermission } from "#/features/auth/session";
import {
  parseAvailabilityRequest,
  parseRoomLayoutInput,
  parseRoomLayoutKey,
  parseVenueBlockId,
  parseVenueBlockInput,
  parseVenueId,
  parseVenueInput,
  parseVenueSearchRequest,
} from "#/features/venues/schema";
import type { VenueBufferConflict } from "#/features/venues/availability";
import { logger } from "#/lib/logger";

const log = logger.getChild("venues");

/**
 * Routes import this module. Keep it free of static server imports. The middleware pipeline is
 * client-safe. Load `./records.server` and `#/db` inside handlers. TanStack Start strips
 * handler bodies from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/venues/records.server")]);
}

/** Shape a venue row as the client sees it. Derive it here so routes avoid the server module. */
export type Venue = Awaited<ReturnType<typeof listVenues>>[number];
export type VenueWithConflicts = Venue & { bufferConflicts?: VenueBufferConflict[] };

/** Create or update a venue in `saveVenue`. The payload id selects the path. */
function venueAction(data: unknown): "create" | "update" {
  return typeof data === "object" && data !== null && "id" in data && data.id !== undefined
    ? "update"
    : "create";
}

export const requireVenueRead = requirePermission({ venue: ["read"] });
export const requireVenueSearch = requirePermission({ venue: ["search"] });
export const requireVenueWrite = requirePermission(data => ({ venue: [venueAction(data)] }));

/**
 * Venue Staff record and lift blocks with `venue:update`. A block payload has no `id`, so
 * `requireVenueWrite` would ask for `venue:create`.
 */
export const requireVenueBlock = requirePermission({ venue: ["update"] });

/**
 * Venue Staff maintain the room layout list with `venue:update`. Coordinators and Technical
 * Support read it through `requireVenueRead` for forms, filters, and suitability.
 */
export const requireRoomLayoutWrite = requirePermission({ venue: ["update"] });

async function loadLayoutServer() {
  return Promise.all([import("#/db"), import("#/features/venues/layouts.server")]);
}

async function loadBlockServer() {
  return Promise.all([import("#/db"), import("#/features/venues/blocks.server")]);
}

export const listVenues = createServerFn({ method: "GET" })
  .middleware([requireVenueRead])
  .handler(async () => {
    const [{ db }, { handleListVenues }] = await loadServer();
    return handleListVenues(db);
  });

/** List `{ id, name }` pairs for pickers. Omit other venue columns that `listVenues` carries. */
export const listVenueOptions = createServerFn({ method: "GET" })
  .middleware([requireVenueRead])
  .handler(async () => {
    const [{ db }, { handleListVenueOptions }] = await loadServer();
    return handleListVenueOptions(db);
  });

export const searchVenues = createServerFn({ method: "GET" })
  .validator(parseVenueSearchRequest)
  .middleware([requireVenueSearch])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSearchVenues }] = await loadServer();
    return handleSearchVenues(data, context.user, db);
  });

export type VenueSearchResult = Awaited<ReturnType<typeof searchVenues>>;

/**
 * Wrap the result in an object. A top-level `Venue | null` result infers as `never` under
 * @tanstack/react-start 1.168, so the loader cannot read `venue.name`. `{ venue }` keeps the
 * type intact.
 */
export const getVenue = createServerFn({ method: "GET" })
  .validator(parseVenueId)
  .middleware([requireVenueRead])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetVenue }] = await loadServer();
    return {
      venue: await handleGetVenue(data, db, {
        includeConflicts: can(context.user.role, { venue: ["update"] }),
      }),
    };
  });

export const saveVenue = createServerFn({ method: "POST" })
  .validator(parseVenueInput)
  .middleware([requireVenueWrite])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveVenue }] = await loadServer();
    const venue = await handleSaveVenue(data, db, context.user.id);

    log.info(venueAction(data) === "create" ? "Venue created" : "Venue updated", {
      venueId: venue.id,
      name: venue.name,
      actorId: context.user.id,
    });

    return venue;
  });

/**
 * Read the availability calendar (PTR-28). Any holder of `venue:read` can call it: Coordinators,
 * Venue Staff, and Technical Support Staff who can read a venue record. Nobody external can call
 * it. Criterion 5 places this check at the endpoint. The guard does not enforce it.
 *
 * Wrap the result in `{ availability }` as `getVenue` does above. A missing venue returns `null`,
 * and the route turns that into the router's `notFound()`.
 */
export const getVenueAvailability = createServerFn({ method: "GET" })
  .validator(parseAvailabilityRequest)
  .middleware([requireVenueRead])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetVenueAvailability }] = await loadServer();
    return { availability: await handleGetVenueAvailability(data, context.user.id, db) };
  });

/** Shape the calendar schedule as the client sees it. Derive it here, as with `Venue` above. */
export type VenueAvailability = NonNullable<
  Awaited<ReturnType<typeof getVenueAvailability>>["availability"]
>;

export const recordVenueBlock = createServerFn({ method: "POST" })
  .validator(parseVenueBlockInput)
  .middleware([requireVenueBlock])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRecordVenueBlock }] = await loadBlockServer();
    const block = await handleRecordVenueBlock(data, context.user, db);

    log.info("Venue block recorded", {
      blockId: block.id,
      venueId: block.venueId,
      actorId: context.user.id,
    });

    return block;
  });

export const liftVenueBlock = createServerFn({ method: "POST" })
  .validator(parseVenueBlockId)
  .middleware([requireVenueBlock])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleLiftVenueBlock }] = await loadBlockServer();
    const block = await handleLiftVenueBlock(data, context.user, db);

    log.info("Venue block lifted", {
      blockId: block.id,
      venueId: block.venueId,
      actorId: context.user.id,
    });

    return block;
  });

/** List every room layout type by label. Forms, filters, and suitability read this list. */
export const listRoomLayouts = createServerFn({ method: "GET" })
  .middleware([requireVenueRead])
  .handler(async () => {
    const [{ db }, { handleListRoomLayouts }] = await loadLayoutServer();
    return handleListRoomLayouts(db);
  });

/** Shape one layout row as the client sees it. Derive it here so routes avoid the server module. */
export type RoomLayoutOption = Awaited<ReturnType<typeof listRoomLayouts>>[number];

/**
 * Add a layout type, or rename one by saving its key with a new label. Venues store keys,
 * so a rename keeps every tick under the new label.
 */
export const saveRoomLayout = createServerFn({ method: "POST" })
  .validator(parseRoomLayoutInput)
  .middleware([requireRoomLayoutWrite])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveRoomLayout }] = await loadLayoutServer();
    const layout = await handleSaveRoomLayout(data, db);

    log.info("Room layout saved", {
      layoutKey: layout.key,
      actorId: context.user.id,
    });

    return layout;
  });

/**
 * Delete a layout type that no venue supports. A layout that a venue supports is refused,
 * and the refusal names the venues.
 */
export const deleteRoomLayout = createServerFn({ method: "POST" })
  .validator(parseRoomLayoutKey)
  .middleware([requireRoomLayoutWrite])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDeleteRoomLayout }] = await loadLayoutServer();
    await handleDeleteRoomLayout(data, db);

    log.info("Room layout deleted", {
      layoutKey: data.key,
      actorId: context.user.id,
    });
  });
