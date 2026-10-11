// oxlint-disable node/no-process-env
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";

/** PTR-8 criterion 5: middleware establishes the session, then `handleListEvents` checks database
 * relationships and refuses access to a named event. E2E tests cover dashboard projections. This
 * test checks refusal without a fixture: an unknown id and an event with no caller relationship
 * must look the same.
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

  /** No seeded account has this id, so no relationship can match it. */
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
