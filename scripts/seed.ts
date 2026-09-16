// oxlint-disable node/no-process-env, no-console
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
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
 * Shared password for every seeded account (PTR-59): the internal staff accounts, the demo
 * organiser and the demo attendee.
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
 * are assigned by the database. Dates are relative to seed time, not fixed: "future" has to
 * stay true whichever day the seed runs. `YYYY-MM-DD HH:MM:SS` is the `mode: "string"` shape
 * the column reads back. Re-run idempotency is the per-venue existence check in `runSeed`
 * rather than the unique period index, because a moving date never collides.
 */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function futureDay(days: number, time = "00:00:00"): string {
  return `${futureDate(days)} ${time}`;
}

export const seedVenueUnavailability: {
  venueName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}[] = [
  {
    venueName: "Harbour Hall",
    startsAt: futureDay(30),
    endsAt: futureDay(34, "23:59:59"),
    reason: "Annual floor resurfacing",
  },
  {
    venueName: "Seminar Room 2A",
    startsAt: futureDay(45, "09:00:00"),
    endsAt: futureDay(45, "18:00:00"),
    reason: "Internal staff training",
  },
];
/**
 * PTR-8: the demo event is a submitted event request, because the event record does not exist
 * until PTR-21/24 and `event_requests` is what access is checked against. The name doubles as
 * the idempotency key — looked up with the organiser before insert, since `id` is serial and
 * pinning it would make the next application insert collide with the sequence.
 */
export const DEMO_EVENT_NAME = "ConnectSphere Demo Summit";
const DEMO_EVENT_ORGANISER_ID = "test-user-2";
const DEMO_EVENT_COORDINATOR_ID = "seed-coordinator-1";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Executes idempotent insertion of seed users and staff credentials.
 */
export async function runSeed(database: Database): Promise<void> {
  await database.insert(schema.user).values(seedUsers).onConflictDoNothing();
  await database.insert(schema.user).values(seedStaffUsers).onConflictDoNothing();

  // One hash for every seed account: they share a password, and a scrypt hash verifies
  // regardless of which account row holds it. onConflictDoNothing keeps re-runs duplicate-free.
  const seedPasswordHash = await hashPassword(SEED_STAFF_PASSWORD);
  await database
    .insert(schema.account)
    .values(
      [...seedStaffUsers, ...seedUsers].map(user => ({
        id: `seed-account-${user.id}`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: seedPasswordHash,
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

  const venuesWithPeriods = new Set(
    (
      await database
        .select({ venueId: schema.venueUnavailability.venueId })
        .from(schema.venueUnavailability)
        .where(inArray(schema.venueUnavailability.venueId, [...venueIdByName.values()]))
    ).map(row => row.venueId)
  );

  const missingPeriods = seedVenueUnavailability.flatMap(period => {
    const venueId = venueIdByName.get(period.venueName);
    if (venueId === undefined) {
      throw new Error(`Seed venue "${period.venueName}" was not inserted`);
    }
    // Dates are relative to seed time, so a second run would insert twin rows rather than
    // collide with the unique period index.
    return venuesWithPeriods.has(venueId)
      ? []
      : [{ venueId, startsAt: period.startsAt, endsAt: period.endsAt, reason: period.reason }];
  });

  if (missingPeriods.length > 0) {
    await database.insert(schema.venueUnavailability).values(missingPeriods).onConflictDoNothing();
  }
  // One transaction with the request row locked. Integration suites share this database and
  // delete event requests, so a lookup followed by separate inserts could have its parent row
  // deleted between the two statements; the lock makes such a delete wait until the children
  // are written, and an inserted row is invisible to a concurrent delete until commit.
  await database.transaction(async tx => {
    const existingDemoRequests = await tx
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, DEMO_EVENT_ORGANISER_ID),
          eq(schema.eventRequests.eventName, DEMO_EVENT_NAME)
        )
      )
      .limit(1)
      .for("update");

    // Relative to seed time, and rewritten on every run: a database seeded more than a month ago
    // would otherwise keep a registration window that has since closed.
    const demoTiming = {
      proposedDates: [{ start: `${futureDate(30)}T09:00`, end: `${futureDate(30)}T17:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(29)}T17:00`,
    };

    let demoRequestId = existingDemoRequests.at(0)?.id;
    if (demoRequestId === undefined) {
      const [inserted] = await tx
        .insert(schema.eventRequests)
        .values({
          organiserId: DEMO_EVENT_ORGANISER_ID,
          status: "submitted",
          submittedAt: new Date(),
          assignedCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
          assignedAt: new Date(),
          eventName: DEMO_EVENT_NAME,
          purpose: "Exercise each role's event access locally.",
          ...demoTiming,
          expectedAttendance: 120,
          description: "A seeded event for exercising role-aware event access locally.",
          eventType: "Conference",
          venueRequirements: "Projector, stage lighting and registration desk",
          roomLayoutPreference: "Theatre seating",
          accessibilityRequirements: "Step-free access and hearing loop",
          equipmentRequirements: [{ type: "Projector", quantity: 1 }],
          specialArrangements: "",
          registrationEnabled: true,
          registrationCapacity: 150,
        })
        .returning({ id: schema.eventRequests.id });

      demoRequestId = inserted.id;
    } else {
      await tx
        .update(schema.eventRequests)
        .set(demoTiming)
        .where(eq(schema.eventRequests.id, demoRequestId));
    }

    await tx
      .insert(schema.venueRequests)
      .values({
        id: "demo-venue-request-1",
        eventId: demoRequestId,
        assignedStaffId: "seed-venue-staff-1",
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.equipmentRequests)
      .values({
        id: "demo-equipment-request-1",
        eventId: demoRequestId,
        assignedStaffId: "seed-tech-support-1",
        item: "Projector",
        arrangementStatus: "reserved",
        notes: "HDMI adapter included",
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.eventRegistrations)
      .values({ eventId: demoRequestId, attendeeId: "test-user-1" })
      .onConflictDoNothing();
  });
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
