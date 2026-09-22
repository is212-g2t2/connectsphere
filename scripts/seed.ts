// oxlint-disable node/no-process-env, no-console
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
 * the column reads back. Re-run convergence replaces the seed's own `(venue, reason)` rows in
 * `runSeed` rather than relying on the unique period index, because a moving date never collides.
 */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function futureDay(days: number, time = "00:00:00"): string {
  return `${futureDate(days)} ${time}`;
}

/**
 * Harbour Hall closes on Sunday and is blocked for resurfacing across futureDay(30)–futureDay(34),
 * so the demo request needs a Mon–Sat slot clear of both. A landed Sunday steps forward to Monday;
 * a UTC weekday keeps the string it returns consistent with the calendar day `futureDate` derives.
 */
function futureWeekdayDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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

/**
 * A fixed key every seed takes before it looks up the demo request. The lookup-then-insert guard
 * alone is unsafe: a zero-row `select ... for update` takes no lock, so two concurrent seeds both
 * see nothing and both insert. The advisory lock serialises them instead.
 */
const DEMO_EVENT_SEED_LOCK_KEY = 970_097;

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

  // Dates are relative to seed time, so a re-run has to replace the seed's own periods rather
  // than skip a venue that already has one: a stale block would otherwise swallow the demo
  // event, which moves forward on every run. `(venue, reason)` is the seed's own key — the
  // unique period index cannot be it, because a moving date never collides.
  await database.delete(schema.venueUnavailability).where(
    and(
      inArray(schema.venueUnavailability.venueId, [...venueIdByName.values()]),
      inArray(
        schema.venueUnavailability.reason,
        seedVenueUnavailability.map(period => period.reason)
      )
    )
  );

  await database
    .insert(schema.venueUnavailability)
    .values(
      seedVenueUnavailability.map(period => {
        const venueId = venueIdByName.get(period.venueName);
        if (venueId === undefined) {
          throw new Error(`Seed venue "${period.venueName}" was not inserted`);
        }
        return { venueId, startsAt: period.startsAt, endsAt: period.endsAt, reason: period.reason };
      })
    )
    .onConflictDoNothing();
  // One transaction with an advisory lock held for its duration: two concurrent seeds serialise
  // here instead of racing the lookup. The request row is also locked when it exists, so a
  // concurrent delete waits until the children are written.
  await database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_EVENT_SEED_LOCK_KEY})`);

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
    // would otherwise keep a registration window that has since closed. One date is computed once
    // so a run crossing midnight cannot produce a start and end on different days.
    const demoDate = futureWeekdayDate(20);
    const demoTiming = {
      proposedDates: [{ start: `${demoDate}T09:00`, end: `${demoDate}T17:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(19)}T17:00`,
    };
    // Harbour Hall's stored facilities/accessibility match this text word-for-word, so the event's
    // prefilled search is a genuine PTR-29 AC5 match rather than a zero-result demo.
    const demoRequirements = {
      expectedAttendance: 120,
      venueRequirements: "Projector, PA system",
      roomLayoutPreference: "Theatre seating",
      accessibilityRequirements: "Step-free access and hearing loop",
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
          ...demoRequirements,
          description: "A seeded event for exercising role-aware event access locally.",
          eventType: "Conference",
          equipmentRequirements: [{ type: "Projector", quantity: 1 }],
          specialArrangements: "",
          registrationEnabled: true,
          registrationCapacity: 150,
        })
        .returning({ id: schema.eventRequests.id });

      demoRequestId = inserted.id;
    } else {
      // Requirements are rewritten too: a long-lived local database would otherwise keep the old
      // text and never converge on the matchable demo request.
      await tx
        .update(schema.eventRequests)
        .set({ ...demoTiming, ...demoRequirements })
        .where(eq(schema.eventRequests.id, demoRequestId));
    }

    const demoVenueId = venueIdByName.get("Harbour Hall");
    if (demoVenueId === undefined) {
      throw new Error('Seed venue "Harbour Hall" was not inserted');
    }

    // The event's own window: the demo request is what a Coordinator would raise from it. One
    // object feeds both statements, so a window edit cannot reach only one of them. `requestedById`
    // is the demo Coordinator, the identity AC5 authorizes withdrawal on.
    const demoVenueRequest = {
      venueId: demoVenueId,
      requestedById: DEMO_EVENT_COORDINATOR_ID,
      startsAt: `${demoDate} 09:00:00`,
      endsAt: `${demoDate} 17:00:00`,
    };

    // Rewritten the way the demo event above is: the window moves with `demoDate`, and `status`
    // comes back to `pending` so a local row withdrawn in the UI converges on every run.
    // `assignedStaffId` is left alone — the integration tests rely on the demo row being assigned
    // to the venue-staff fixture, not a generic staff user.
    const existingDemoVenueRequests = await tx
      .select({ id: schema.venueRequests.id })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "demo-venue-request-1"))
      .limit(1);

    if (existingDemoVenueRequests.length === 0) {
      await tx.insert(schema.venueRequests).values({
        id: "demo-venue-request-1",
        eventId: demoRequestId,
        ...demoVenueRequest,
        assignedStaffId: "seed-venue-staff-1",
      });
    } else {
      await tx
        .update(schema.venueRequests)
        .set({ ...demoVenueRequest, status: "pending" })
        .where(eq(schema.venueRequests.id, "demo-venue-request-1"));
    }
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
