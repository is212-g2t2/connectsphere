// oxlint-disable node/no-process-env
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "#/db/schema";
import { DEMO_EVENT_NAME, runSeed, seedStaffUsers, SEED_STAFF_PASSWORD } from "../../scripts/seed";

// `integration-setup.ts` provides the database, but Vitest aliases `bun:sql` to a no-op stub
// (`tests/shims/bun.ts`). The app's `#/db` client cannot query this database. `betterAuth()` captures
// the module-level client at import time, so mock `#/db`, as in `auth-validation.test.ts`. Use
// `vi.hoisted` so the mock and `afterAll` can close the same pool.
const { pool } = await vi.hoisted(async () => {
  const { Pool } = await import("pg");
  return { pool: new Pool({ connectionString: process.env.DATABASE_URL }) };
});

vi.mock("#/db", async () => {
  const { drizzle: drizzleNode } = await import("drizzle-orm/node-postgres");
  const nodeSchema = await import("#/db/schema");
  return { client: pool, db: drizzleNode(pool, { schema: nodeSchema }) };
});

// Sign-in sends no email. Keep the mailer stubbed so tests cannot send real email.
vi.mock("#/lib/mailer.server", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail: vi.fn<() => Promise<unknown>>(async () => ({ id: "test-email" })),
}));

const { auth } = await import("#/lib/auth.server");

const db = drizzle(pool, { schema });

afterAll(async () => {
  await pool.end();
});

const BASE_URL = "http://localhost:3000";

const staffIds = seedStaffUsers.map(user => user.id);

describe("seeded staff accounts (PTR-59)", () => {
  it("records one account per internal role (AC1)", async () => {
    const rows = await db
      .select({ id: schema.user.id, role: schema.user.role })
      .from(schema.user)
      .where(inArray(schema.user.id, staffIds));

    expect(rows).toHaveLength(7);
    expect(new Set(rows.map(row => row.role))).toEqual(
      new Set([
        "event_coordinator",
        "event_coordinator_lead",
        "venue_staff",
        "technical_support_staff",
        "safety_officer",
      ])
    );
    expect(rows.filter(row => row.role === "event_coordinator")).toHaveLength(2);
    expect(rows.filter(row => row.role === "event_coordinator_lead")).toHaveLength(2);
  });

  it("holds a credential account for each staff user", async () => {
    const rows = await db
      .select({ providerId: schema.account.providerId, password: schema.account.password })
      .from(schema.account)
      .where(inArray(schema.account.userId, staffIds));

    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.providerId).toBe("credential");
      expect(row.password).toBeTruthy();
    }
  });

  it.each(seedStaffUsers)("signs in as $email without registration (AC2)", async staff => {
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: staff.email, password: SEED_STAFF_PASSWORD }),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("does not duplicate accounts or records on re-seed (AC5)", async () => {
    await runSeed(db);
    await runSeed(db);

    const users = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(inArray(schema.user.id, staffIds));
    const accounts = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(inArray(schema.account.userId, staffIds));

    expect(users).toHaveLength(7);
    expect(accounts).toHaveLength(7);
  });

  it("records one demo request when two seeds run at once", async () => {
    // Remove the seeded demo request so both calls test insertion, not update.
    await db
      .delete(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, "test-user-2"),
          eq(schema.eventRequests.eventName, DEMO_EVENT_NAME)
        )
      );

    await Promise.all([runSeed(db), runSeed(db)]);

    const demoRequests = await db
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, "test-user-2"),
          eq(schema.eventRequests.eventName, DEMO_EVENT_NAME)
        )
      );

    expect(demoRequests).toHaveLength(1);
  });
});
