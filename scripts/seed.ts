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
 * Use this password for every seeded account: staff, the demo organiser, and the demo attendee (PTR-59).
 * This password is for development only. Do not put personal data here. The password meets
 * PasswordSchema: 8–128 characters, including a digit and a symbol.
 */
export const SEED_STAFF_PASSWORD = "Seed-Pass123!";

/**
 * Create internal staff accounts for the seed (PTR-59). Sign-up permits only external roles
 * (PTR-5), so insert these accounts directly and bypass the sign-up validator.
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
 * Create demo venues for PTR-59 criterion 3 with the PTR-26 schema. The unique `venues.name`
 * field is the idempotency key, so a re-run does not add duplicate venues. `operatingHours` uses
 * weekday wall-clock times in `HH:MM` format. Use `null` for a closed day.
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
 * Add two future unavailable periods for PTR-59 criterion 4. The PTR-28 availability calendar
 * can then show unavailable periods as well as bookings. Use venue names as keys because the
 * database assigns venue ids. Calculate dates from seed time so they stay in the future on every
 * run. Store timestamps as `YYYY-MM-DD HH:MM:SS`, the column's `mode: "string"` format. On each
 * run, `runSeed` replaces the seed's `(venue, reason)` rows. Moving dates do not match the unique
 * period index, so that index cannot make the seed repeatable.
 */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function futureDay(days: number, time = "00:00:00"): string {
  return `${futureDate(days)} ${time}`;
}

/**
 * Harbour Hall closes on Sunday and has resurfacing blocks from futureDay(30) to futureDay(34).
 * Keep the demo request on a free Monday-to-Saturday slot. If the date is Sunday, move it to
 * Monday. Use a UTC weekday so the returned string matches the calendar day from `futureDate`.
 */
function futureWeekdayDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Seminar Room 2A is closed on weekends. Move the attendee demo date to Monday if it falls on
 * Saturday or Sunday. Harbour Hall opens on Saturdays, so use `futureWeekdayDate` for that venue.
 */
function futureOpenDayDate(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
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
 * Small fictional catalogue for the equipment availability stories. The unique
 * `equipment_types.name` field is the idempotency key.
 */
export const seedEquipmentTypes: Omit<typeof schema.equipmentTypes.$inferInsert, "id">[] = [
  { name: "Portable Projector", quantityHeld: 8 },
  { name: "Wireless Microphone", quantityHeld: 12 },
  { name: "Portable PA System", quantityHeld: 4 },
];

/**
 * Add a fictional out-of-service quantity. The equipment type still has held units, and the seed
 * does not represent a real asset.
 */
export const seedEquipmentUnavailability: {
  equipmentTypeName: string;
  quantityUnavailable: number;
  reason: string;
}[] = [
  {
    equipmentTypeName: "Portable Projector",
    quantityUnavailable: 1,
    reason: "Demo unit under maintenance",
  },
];
/**
 * PTR-8: seed the demo event as a submitted event request. The event record does not exist until
 * PTR-21/24, and access checks use `event_requests`. Use the name and organiser as the idempotency
 * key. Look up the row before insert because `id` is serial; a fixed id could conflict with the
 * next application insert.
 */
export const DEMO_EVENT_NAME = "ConnectSphere Demo Summit";
const DEMO_EVENT_ORGANISER_ID = "test-user-2";
const DEMO_EVENT_COORDINATOR_ID = "seed-coordinator-1";

/**
 * PTR-44: seed a confirmed event with registration enabled for the attendee demo. New attendees
 * can see it because browsing requires `confirmed` and `registrationEnabled`; it does not check
 * the registration window. Keep this event separate from the submitted, planning-stage demo used
 * for venue search and equipment requests. Find it by organiser and name before each insert. On
 * every run, update the required `confirmed` attribution and future dates.
 */
export const ATTENDEE_DEMO_EVENT_NAME = "ConnectSphere Open Day";
export const ATTENDEE_DEMO_VENUE_NAME = "Seminar Room 2A";

/**
 * Every seed takes this fixed key before it looks up the demo request. A lookup then insert is not
 * safe by itself: `select ... for update` takes no lock when it finds no row, so concurrent seeds
 * can both insert. The advisory lock serializes those seeds.
 */
const DEMO_EVENT_SEED_LOCK_KEY = 970_097;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Insert seed users and staff credentials. Repeated runs do not add duplicates.
 */
export async function runSeed(database: Database): Promise<void> {
  await database.insert(schema.user).values(seedUsers).onConflictDoNothing();
  await database.insert(schema.user).values(seedStaffUsers).onConflictDoNothing();

  // Seed accounts share one password, so they can share one scrypt hash. `onConflictDoNothing`
  // keeps repeated runs free of duplicate rows.
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
  await database.insert(schema.equipmentTypes).values(seedEquipmentTypes).onConflictDoNothing();

  const equipmentTypeRows = await database
    .select({ id: schema.equipmentTypes.id, name: schema.equipmentTypes.name })
    .from(schema.equipmentTypes)
    .where(
      inArray(
        schema.equipmentTypes.name,
        seedEquipmentTypes.map(type => type.name)
      )
    );
  const equipmentTypeIdByName = new Map(equipmentTypeRows.map(type => [type.name, type.id]));

  await database
    .insert(schema.equipmentUnavailability)
    .values(
      seedEquipmentUnavailability.map(record => {
        const equipmentTypeId = equipmentTypeIdByName.get(record.equipmentTypeName);
        if (equipmentTypeId === undefined) {
          throw new Error(`Seed equipment type "${record.equipmentTypeName}" was not inserted`);
        }
        return {
          equipmentTypeId,
          quantityUnavailable: record.quantityUnavailable,
          reason: record.reason,
        };
      })
    )
    .onConflictDoNothing();

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

  // Dates use seed time. Replace the seed's periods on each run instead of skipping a venue with
  // an existing period. Otherwise, an old block could cover the demo event as its date moves.
  // Use `(venue, reason)` as the seed's key because moving dates do not match the unique period index.
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
  // Hold the advisory lock for the transaction so concurrent seeds do not race the lookup. Lock
  // the request row when it exists, so a concurrent delete waits until the seed writes its children.
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

    // Use seed time and update this window on every run. A database seeded more than a month ago
    // would keep a closed window. Compute the date once so a run across midnight uses one day for
    // both the start and end.
    const demoDate = futureWeekdayDate(20);
    const demoTiming = {
      proposedDates: [{ start: `${demoDate}T09:00`, end: `${demoDate}T17:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(19)}T17:00`,
    };
    // This text matches Harbour Hall's facilities and accessibility fields exactly. The prefilled
    // search therefore returns the PTR-29 AC5 demo result.
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
      // Update the requirements too, so an old local database gets the current searchable demo
      // text. If an earlier seed left this event confirmed, restore `submitted`. That status has
      // no decision or confirmation attribution, as the CHECK constraints require.
      await tx
        .update(schema.eventRequests)
        .set({
          ...demoTiming,
          ...demoRequirements,
          status: "submitted",
          submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
          decisionReason: null,
          decidedByCoordinatorId: null,
          decidedByCoordinatorName: null,
          decidedAt: null,
          confirmedById: null,
          confirmedByName: null,
          confirmedAt: null,
          equipmentSubmittedAt: null,
          equipmentArrangementsCompletedAt: null,
          equipmentArrangementsCompletedById: null,
        })
        .where(eq(schema.eventRequests.id, demoRequestId));
    }

    const demoVenueId = venueIdByName.get("Harbour Hall");
    if (demoVenueId === undefined) {
      throw new Error('Seed venue "Harbour Hall" was not inserted');
    }

    // Use the demo event's window for its Coordinator request. Both statements use this object, so
    // a window change updates both. `requestedById` is the demo Coordinator who AC5 allows to
    // withdraw the request.
    const demoVenueRequest = {
      venueId: demoVenueId,
      requestedById: DEMO_EVENT_COORDINATOR_ID,
      startsAt: `${demoDate} 09:00:00`,
      endsAt: `${demoDate} 17:00:00`,
    };

    // Update the window from `demoDate` and reset the status to `pending` on every run. This also
    // restores a row that someone withdrew in the UI. Keep `assignedStaffId` unchanged because
    // integration tests require the venue-staff fixture on this row.
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

    // This is the booking shown on the attendee page (PTR-44 AC2). Use Seminar Room 2A, not
    // Harbour Hall, so it does not overlap the pending Harbour Hall request above or show the
    // PTR-36 conflict badge. No other approved booking uses this venue. Leave this booking
    // unassigned so the venue-staff dashboard shows one pending demo request. The approved booking
    // still appears on the venue-bookings page. `ON DELETE SET NULL` makes an unassigned booking a
    // valid state.
    const attendeeVenueId = venueIdByName.get(ATTENDEE_DEMO_VENUE_NAME);
    if (attendeeVenueId === undefined) {
      throw new Error(`Seed venue "${ATTENDEE_DEMO_VENUE_NAME}" was not inserted`);
    }

    const existingAttendeeEvents = await tx
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(
        and(
          eq(schema.eventRequests.organiserId, DEMO_EVENT_ORGANISER_ID),
          eq(schema.eventRequests.eventName, ATTENDEE_DEMO_EVENT_NAME)
        )
      )
      .limit(1)
      .for("update");

    // Keep this event one week after the other demo event so their windows do not overlap. Update
    // the dates on every run, as above. Keep registration open from yesterday until about 18 days
    // from now so the seeded attendee can show the registered state.
    const attendeeDate = futureOpenDayDate(27);
    const attendeeTiming = {
      proposedDates: [{ start: `${attendeeDate}T10:00`, end: `${attendeeDate}T16:00` }],
      registrationOpensAt: `${futureDate(-1)}T09:00`,
      registrationClosesAt: `${futureDate(18)}T17:00`,
    };
    const attendeeRequirements = {
      expectedAttendance: 30,
      venueRequirements: "Projector, video conferencing",
      roomLayoutPreference: "Classroom",
      accessibilityRequirements: "Step-free access",
    };

    // A confirmed event must record who decided and who confirmed it. The CHECK constraints
    // enforce this. Use the seeded Coordinator for both fields and update them on every run so an
    // older database does not keep incomplete values.
    const attendeeAttribution = {
      status: "confirmed" as const,
      decidedByCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
      decidedByCoordinatorName: "Seeded Event Coordinator",
      decidedAt: new Date(),
      confirmedById: DEMO_EVENT_COORDINATOR_ID,
      confirmedByName: "Seeded Event Coordinator",
      confirmedAt: new Date(),
    };

    let attendeeEventId = existingAttendeeEvents.at(0)?.id;
    if (attendeeEventId === undefined) {
      const [inserted] = await tx
        .insert(schema.eventRequests)
        .values({
          organiserId: DEMO_EVENT_ORGANISER_ID,
          submittedAt: new Date(),
          assignedCoordinatorId: DEMO_EVENT_COORDINATOR_ID,
          assignedAt: new Date(),
          eventName: ATTENDEE_DEMO_EVENT_NAME,
          purpose: "Show attendees a confirmed event with registration open.",
          ...attendeeTiming,
          ...attendeeRequirements,
          ...attendeeAttribution,
          description:
            "An open day for new members: meet the organisers, tour the rooms, and try a workshop.",
          eventType: "Open Day",
          registrationEnabled: true,
          registrationCapacity: 40,
        })
        .returning({ id: schema.eventRequests.id });

      attendeeEventId = inserted.id;
    } else {
      // Update the registration terms too. A flag turned off by hand returns to its seeded value.
      await tx
        .update(schema.eventRequests)
        .set({
          ...attendeeTiming,
          ...attendeeRequirements,
          ...attendeeAttribution,
          submittedAt: sql`coalesce(${schema.eventRequests.submittedAt}, now())`,
          registrationEnabled: true,
          registrationCapacity: 40,
        })
        .where(eq(schema.eventRequests.id, attendeeEventId));
    }

    const attendeeVenueRequest = {
      venueId: attendeeVenueId,
      requestedById: DEMO_EVENT_COORDINATOR_ID,
      startsAt: `${attendeeDate} 10:00:00`,
      endsAt: `${attendeeDate} 16:00:00`,
      status: "approved" as const,
      assignedStaffId: null,
    };

    const existingAttendeeVenueRequests = await tx
      .select({ id: schema.venueRequests.id })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "demo-attendee-venue-request-1"))
      .limit(1);

    if (existingAttendeeVenueRequests.length === 0) {
      await tx.insert(schema.venueRequests).values({
        id: "demo-attendee-venue-request-1",
        eventId: attendeeEventId,
        ...attendeeVenueRequest,
      });
    } else {
      await tx
        .update(schema.venueRequests)
        .set(attendeeVenueRequest)
        .where(eq(schema.venueRequests.id, "demo-attendee-venue-request-1"));
    }

    const projectorTypeId = equipmentTypeIdByName.get("Portable Projector");

    await tx
      .insert(schema.equipmentRequests)
      .values({
        id: "demo-equipment-request-1",
        eventId: demoRequestId,
        assignedStaffId: "seed-tech-support-1",
        item: "Projector",
        quantity: 1,
        equipmentTypeId: projectorTypeId ?? null,
        arrangementStatus: "reserved",
        notes: "HDMI adapter included",
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.eventRegistrations)
      .values({ eventId: demoRequestId, attendeeId: "test-user-1" })
      .onConflictDoNothing();
    await tx
      .insert(schema.eventRegistrations)
      .values({ eventId: attendeeEventId, attendeeId: "test-user-1" })
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
