// oxlint-disable node/no-process-env
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";

export async function seededBlockDate(venueName: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [period] = await drizzle(pool, { schema })
      .select({ startsAt: schema.venueUnavailability.startsAt })
      .from(schema.venueUnavailability)
      .innerJoin(schema.venues, eq(schema.venueUnavailability.venueId, schema.venues.id))
      .where(eq(schema.venues.name, venueName))
      .orderBy(asc(schema.venueUnavailability.startsAt))
      .limit(1);
    if (!period) throw new Error(`No seeded block found for ${venueName}`);
    return period.startsAt.slice(0, 10);
  } finally {
    await pool.end();
  }
}
