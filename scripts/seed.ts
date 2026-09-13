// oxlint-disable node/no-process-env, no-console
import { hashPassword } from "better-auth/crypto";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";

export type SeedUser = typeof schema.user.$inferInsert;

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

export type SeedVenue = Omit<typeof schema.venues.$inferInsert, "id">;

/**
 * Demo venues (PTR-59 criterion 3, landing with the schema from PTR-26). Names are the
 * idempotency key — `venues.name` is unique — so a re-run collides instead of inserting twins.
 * `operatingHours` is `"HH:MM"` wall-clock per weekday, `null` for closed.
 */
export const seedVenues: SeedVenue[] = [
  {
    name: "Harbour Hall",
    location: "Level 1, ConnectSphere Marina Centre",
    maxCapacity: 300,
    facilities: ["Stage", "Projector", "PA system", "Wi-Fi", "Catering prep area"],
    accessibilityFeatures: ["Step-free access", "Accessible toilets", "Hearing loop"],
    supportedLayouts: ["theatre", "banquet", "exhibition"],
    operatingHours: {
      mon: { opens: "08:00", closes: "22:00" },
      tue: { opens: "08:00", closes: "22:00" },
      wed: { opens: "08:00", closes: "22:00" },
      thu: { opens: "08:00", closes: "22:00" },
      fri: { opens: "08:00", closes: "23:00" },
      sat: { opens: "09:00", closes: "23:00" },
      sun: null,
    },
  },
  {
    name: "Seminar Room 2A",
    location: "Level 2, ConnectSphere Marina Centre",
    maxCapacity: 40,
    facilities: ["Projector", "Whiteboard", "Video conferencing", "Wi-Fi"],
    accessibilityFeatures: ["Step-free access", "Adjustable-height desks"],
    supportedLayouts: ["classroom", "boardroom"],
    operatingHours: {
      mon: { opens: "09:00", closes: "18:00" },
      tue: { opens: "09:00", closes: "18:00" },
      wed: { opens: "09:00", closes: "18:00" },
      thu: { opens: "09:00", closes: "18:00" },
      fri: { opens: "09:00", closes: "18:00" },
      sat: null,
      sun: null,
    },
  },
  {
    name: "Rooftop Pavilion",
    location: "Level 12, ConnectSphere Tower",
    maxCapacity: 120,
    facilities: ["PA system", "Bar counter", "Wi-Fi"],
    accessibilityFeatures: ["Lift access"],
    supportedLayouts: ["banquet", "other"],
    operatingHours: {
      mon: null,
      tue: null,
      wed: { opens: "17:00", closes: "23:00" },
      thu: { opens: "17:00", closes: "23:00" },
      fri: { opens: "17:00", closes: "23:30" },
      sat: { opens: "11:00", closes: "23:30" },
      sun: { opens: "11:00", closes: "21:00" },
    },
  },
];

/**
 * Two future periods of unavailability (PTR-59 criterion 4) so the availability calendar
 * (PTR-28) has something to show that is not a booking. Keyed by venue name because venue ids
 * are assigned by the database. Fixed far-future dates rather than "today + n": the unique
 * period index is what makes re-runs idempotent, and a moving date would defeat it.
 */
export const seedVenueUnavailability: {
  venueName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}[] = [
  {
    venueName: "Harbour Hall",
    startsAt: "2027-03-01 00:00:00",
    endsAt: "2027-03-05 23:59:59",
    reason: "Annual floor resurfacing",
  },
  {
    venueName: "Seminar Room 2A",
    startsAt: "2027-04-12 09:00:00",
    endsAt: "2027-04-12 18:00:00",
    reason: "Internal staff training",
  },
];

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Executes idempotent insertion of seed users and staff credentials.
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

  await database.insert(schema.venues).values(seedVenues).onConflictDoNothing();

  const venueRows = await database
    .select({ id: schema.venues.id, name: schema.venues.name })
    .from(schema.venues)
    .where(
      inArray(
        schema.venues.name,
        seedVenues.map(venue => venue.name)
      )
    );
  const venueIdByName = new Map(venueRows.map(row => [row.name, row.id]));

  await database
    .insert(schema.venueUnavailability)
    .values(
      seedVenueUnavailability.map(period => {
        const venueId = venueIdByName.get(period.venueName);
        if (venueId === undefined) {
          throw new Error(`Seed venue "${period.venueName}" was not inserted`);
        }
        return {
          venueId,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          reason: period.reason,
        };
      })
    )
    .onConflictDoNothing();
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
