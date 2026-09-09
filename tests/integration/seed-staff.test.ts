// oxlint-disable node/no-process-env
import { afterAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "#/db/schema";
import { runSeed, seedStaffUsers, SEED_STAFF_PASSWORD } from "../../scripts/seed";

// integration-setup.ts provides the database (container, DATABASE_URL, schema, seed), but `#/db`
// builds its client from `bun:sql`, which vitest.config.ts aliases to a no-op stub
// (tests/shims/bun.ts) — so `db` cannot execute a query no matter what DATABASE_URL says.
// `betterAuth()` captures the module-level `db` at import time and exposes no other seam,
// so the module itself has to be replaced. (Same seam as auth-validation.test.ts.)
// Built via vi.hoisted so the mock factory and afterAll share one pool this file can close.
const { pool } = await vi.hoisted(async () => {
  const { Pool } = await import("pg");
  return { pool: new Pool({ connectionString: process.env.DATABASE_URL }) };
});

vi.mock("#/db", async () => {
  const { drizzle: drizzleNode } = await import("drizzle-orm/node-postgres");
  const nodeSchema = await import("#/db/schema");
  return { client: pool, db: drizzleNode(pool, { schema: nodeSchema }) };
});

// Sign-in sends no email, but keep the mailer stubbed so no test path can trigger a real send.
vi.mock("#/lib/mailer", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail: vi.fn<() => Promise<unknown>>(async () => ({ id: "test-email" })),
}));

const { auth } = await import("#/lib/auth");

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

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(row => row.role))).toEqual(
      new Set(["event_coordinator", "venue_staff", "technical_support_staff"])
    );
  });

  it("holds a credential account for each staff user", async () => {
    const rows = await db
      .select({ providerId: schema.account.providerId, password: schema.account.password })
      .from(schema.account)
      .where(inArray(schema.account.userId, staffIds));

    expect(rows).toHaveLength(3);
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

    expect(users).toHaveLength(3);
    expect(accounts).toHaveLength(3);
  });
});
