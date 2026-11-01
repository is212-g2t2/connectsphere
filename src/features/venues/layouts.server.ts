import { asc, eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { roomLayouts, venues } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { RoomLayout } from "#/features/venues/schema";
import { LAYOUT_MESSAGE, parseRoomLayoutInput, parseRoomLayoutKey } from "#/features/venues/schema";
import { isConstraintViolation } from "#/lib/db-errors";

/**
 * Keep this module server-only. `server-fns.ts` imports it dynamically inside `.handler()`.
 * Middleware checks the session and `venue` permission before a server function calls these.
 */

type Database = typeof Db;

/** List every layout type by label. Readers use this for forms, filters, and suitability. */
export async function handleListRoomLayouts(
  database: Pick<Database, "select">
): Promise<RoomLayout[]> {
  return database
    .select({ key: roomLayouts.key, label: roomLayouts.label })
    .from(roomLayouts)
    .orderBy(asc(roomLayouts.label));
}

/** Read one list as a key set for membership checks. */
export async function loadRoomLayoutKeys(database: Pick<Database, "select">): Promise<Set<string>> {
  const rows = await database.select({ key: roomLayouts.key }).from(roomLayouts);
  return new Set(rows.map(row => row.key));
}

/** Refuse an unknown layout key with the named message. */
export function assertKnownLayoutKeys(keys: readonly string[], known: Set<string>): void {
  if (keys.some(key => !known.has(key))) throw new Error(LAYOUT_MESSAGE);
}

/**
 * Add a layout type, or rename one by saving its key with a new label. Venues store keys,
 * so a rename keeps every tick under the new label. A label that another key holds is refused.
 */
export async function handleSaveRoomLayout(data: unknown, database: Database): Promise<RoomLayout> {
  const { key, label } = parseRoomLayoutInput(data);
  try {
    return await database.transaction(async tx => {
      const existing = await tx
        .select({ key: roomLayouts.key })
        .from(roomLayouts)
        .where(eq(roomLayouts.key, key))
        .limit(1);
      if (existing.length === 0) {
        const [inserted] = await tx.insert(roomLayouts).values({ key, label }).returning({
          key: roomLayouts.key,
          label: roomLayouts.label,
        });
        return inserted;
      }
      const [updated] = await tx
        .update(roomLayouts)
        .set({ label })
        .where(eq(roomLayouts.key, key))
        .returning({ key: roomLayouts.key, label: roomLayouts.label });
      return updated;
    });
  } catch (error) {
    if (isConstraintViolation(error, "room_layouts_label_unique")) {
      throw new Error("A layout with this label already exists", { cause: error });
    }
    throw error;
  }
}

/** Name the venues that support a layout, for the delete refusal. */
export function roomLayoutInUseMessage(label: string, venueNames: readonly string[]): string {
  return `Cannot delete layout "${label}" because these venues support it: ${venueNames.join(", ")}`;
}

/**
 * Delete a layout type that no venue supports. A layout that a venue supports is refused,
 * and the refusal names the venues.
 */
export async function handleDeleteRoomLayout(data: unknown, database: Database): Promise<void> {
  const { key } = parseRoomLayoutKey(data);
  const rows = await database
    .select({ key: roomLayouts.key, label: roomLayouts.label })
    .from(roomLayouts)
    .where(eq(roomLayouts.key, key))
    .limit(1);
  const row = rows.at(0);
  if (!row) throw new NotFoundError("Not Found");
  const users = await database
    .select({ name: venues.name })
    .from(venues)
    .where(sql`${key} = ANY(${venues.supportedLayouts})`)
    .orderBy(asc(venues.name));
  if (users.length > 0) {
    throw new ConflictError(
      roomLayoutInUseMessage(
        row.label,
        users.map(venue => venue.name)
      )
    );
  }
  await database.delete(roomLayouts).where(eq(roomLayouts.key, key));
}
