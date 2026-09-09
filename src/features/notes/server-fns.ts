import { createServerFn } from "@tanstack/react-start";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";

import type { db as Db } from "#/db";
import { notes } from "#/db/schema";
import { getCurrentUser } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";

// `#/db` is only ever reached through `await import()` inside a handler: a static import here
// drags `bun`'s `SQL` into the client graph via `dashboard.tsx`. Same reason as `auth/session.ts`.
type Database = typeof Db;

export async function handleListNotes(user: SessionUser | null, database: Database) {
  if (!user) throw new Error("Unauthorized");

  return database
    .select()
    .from(notes)
    .where(eq(notes.userId, user.id))
    .orderBy(desc(notes.createdAt));
}

export const listNotes = createServerFn({ method: "GET" }).handler(async () => {
  const [user, { db }] = await Promise.all([getCurrentUser(), import("#/db")]);
  return handleListNotes(user, db);
});

export const CreateNoteInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or fewer"),
});

// Zod's own message is a JSON dump of every issue; routes toast `err.message` straight at
// the user, so both entry points go through this and surface one sentence.
function parseCreateNote(data: { title: string }) {
  const parsed = CreateNoteInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

export async function handleCreateNote(
  data: { title: string },
  user: SessionUser | null,
  database: Database
) {
  if (!user) throw new Error("Unauthorized");

  const { title } = parseCreateNote(data);

  const [note] = await database.insert(notes).values({ title, userId: user.id }).returning();
  return note;
}

export const createNote = createServerFn({ method: "POST" })
  .validator(parseCreateNote)
  .handler(async ({ data }) => {
    const [user, { db }] = await Promise.all([getCurrentUser(), import("#/db")]);
    return handleCreateNote(data, user, db);
  });

export const DeleteNoteInput = z.object({ id: z.number() });

export async function handleDeleteNote(
  data: { id: number },
  user: SessionUser | null,
  database: Database
) {
  if (!user) throw new Error("Unauthorized");

  const deleted = await database
    .delete(notes)
    .where(and(eq(notes.id, data.id), eq(notes.userId, user.id)))
    .returning();

  if (!deleted.length) throw new Error("Note not found");
  return { success: true };
}

export const deleteNote = createServerFn({ method: "POST" })
  .validator(DeleteNoteInput)
  .handler(async ({ data }) => {
    const [user, { db }] = await Promise.all([getCurrentUser(), import("#/db")]);
    return handleDeleteNote(data, user, db);
  });
