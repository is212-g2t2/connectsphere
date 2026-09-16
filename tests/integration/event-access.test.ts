// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";

/**
 * PTR-8 criterion 5 at the handler boundary: the server-function middleware has already
 * established the session, and `handleListEvents` is what decides relationships against the
 * database and refuses a named event. The e2e suite covers the projections through the dashboard;
 * this is the cheap deterministic half for the refusal, which needs no fixture: an id that exists
 * nowhere and a caller connected to nothing must look identical.
 */
describe("event access handler (PTR-8)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  /** No seeded account carries this id, so no relationship query can match it. */
  const unrelated: SessionUser = {
    id: "unrelated-user",
    email: "unrelated@example.invalid",
    role: "event_organiser",
  };

  it("refuses a named event the caller is not connected to, without saying whether it exists", async () => {
    await expect(
      handleListEvents({ eventId: 2_147_483_647 }, unrelated, database as never)
    ).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  });

  it("answers an unrelated caller's bare list with nothing rather than a refusal", async () => {
    expect(await handleListEvents({}, unrelated, database as never)).toEqual([]);
  });
});
