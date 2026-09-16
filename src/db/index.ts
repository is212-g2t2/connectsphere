import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { env } from "#/env";

import * as schema from "./schema";

// Supabase's transaction pooler (:6543) has no prepared statements, so `prepare: false` is not a
// tuning knob. `max: 10` is Bun's default made explicit: 5 instances × 10 = 50 connections.
export const client = new SQL(env.DATABASE_URL, { prepare: false, max: 10 });

export const db = drizzle({
  client,
  schema,
});
