// oxlint-disable node/no-process-env, no-console
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";

export type SeedUser = typeof schema.user.$inferInsert;
export type SeedNote = typeof schema.notes.$inferInsert;

export const seedUsers: SeedUser[] = [
  {
    id: "test-user-1",
    name: "John Doe",
    email: "john.doe@example.com",
    emailVerified: true,
    role: "attendee",
  },
  {
    id: "test-user-2",
    name: "Jane Doe",
    email: "jane.doe@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  {
    id: "user-demo-1",
    name: "Demo User",
    email: "demo@example.com",
    emailVerified: true,
    role: "attendee",
  },
];

export const seedNotes: SeedNote[] = [
  {
    title: "Welcome to TanStack Start Template",
    userId: "user-demo-1",
  },
  {
    title: "Inspect server functions in src/features/notes",
    userId: "user-demo-1",
  },
];

/**
 * Shared password for the seeded internal staff accounts (PTR-59).
 * Obviously non-production and documented in the README — never put real personal data here.
 * It satisfies PasswordSchema (8–128 characters, a digit, a symbol).
 */
export const SEED_STAFF_PASSWORD = "Seed-Pass123!";

/**
 * Internal staff accounts no user story creates (PTR-59): self-registration (PTR-5) only
 * allows external roles, so these are inserted directly, bypassing the sign-up validator.
 */
export const seedStaffUsers: SeedUser[] = [
  {
    id: "seed-coordinator-1",
    name: "Seeded Event Coordinator",
    email: "coordinator.seed@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  {
    id: "seed-venue-staff-1",
    name: "Seeded Venue Staff",
    email: "venue.staff.seed@example.com",
    emailVerified: true,
    role: "venue_staff",
  },
  {
    id: "seed-tech-support-1",
    name: "Seeded Technical Support",
    email: "tech.support.seed@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
];

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Executes idempotent insertion of seed users, staff credentials, and default notes.
 */
export async function runSeed(database: Database): Promise<void> {
  await database.insert(schema.user).values(seedUsers).onConflictDoNothing();
  await database.insert(schema.user).values(seedStaffUsers).onConflictDoNothing();

  // One hash for every staff account: they share a password, and a scrypt hash verifies
  // regardless of which account row holds it. onConflictDoNothing keeps re-runs duplicate-free.
  const staffPasswordHash = await hashPassword(SEED_STAFF_PASSWORD);
  await database
    .insert(schema.account)
    .values(
      seedStaffUsers.map(user => ({
        id: `seed-account-${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: staffPasswordHash,
      }))
    )
    .onConflictDoNothing();

  const existingDemoNotes = await database
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.userId, "user-demo-1"));

  if (existingDemoNotes.length === 0) {
    await database.insert(schema.notes).values(seedNotes);
  }
}

/**
 * Seeds the database using an existing Drizzle instance, a custom connection string,
 * or the default DATABASE_URL environment variable.
 */
export async function seed(databaseOrUrl?: Database | string): Promise<void> {
  if (databaseOrUrl && typeof databaseOrUrl !== "string") {
    await runSeed(databaseOrUrl);
    return;
  }

  const connectionString = databaseOrUrl ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required for seeding");
  }

  const pool = new Pool({ connectionString });
  const database = drizzle(pool, { schema });

  try {
    await runSeed(database);
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  seed()
    .then(() => {
      console.info("Database seeded successfully.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Database seed failed:", err);
      process.exit(1);
    });
}
