import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { env } from "#/env";

import * as schema from "./schema";

// Supabase's transaction pooler on port 6543 does not support prepared statements. Set
// `prepare: false` to disable them. Bun defaults `max` to 10; five instances can use 50 connections.
export const client = new SQL(env.DATABASE_URL, { prepare: false, max: 10 });

export const db = drizzle({
  client,
  schema,
});
