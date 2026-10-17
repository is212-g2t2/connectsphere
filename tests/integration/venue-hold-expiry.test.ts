// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleCreateVenueHold,
  handleSetVenueHoldExpiry,
  handleSetVenueHoldWarning,
} from "#/features/venue-requests/holds.server";
import {
  VENUE_HOLD_EXPIRY_PAST_MESSAGE,
  VENUE_HOLD_WARNING_ORDER_MESSAGE,
} from "#/features/venue-requests/schema";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-142: a tentative hold's expiry and warning at the handler boundary.
 *
 * Acceptance criteria:
 *   AC1: Venue Staff set the expiry; a hold without one is flagged, not swept.
 *   AC2: A change records the acting user and time and notifies the assigned Coordinator.
 *   AC3: The Coordinator sets the warning instant and reads it back.
 *   AC4: An extension keeps the stored warning instant and notifies the Coordinator.
 *   AC5: Setting or extending the expiry leaves the occupancy row and its buffers unchanged.
 */

const users = {
  organiser: {
    id: "ptr142-organiser",
    name: "PTR-142 Organiser",
    email: "ptr142-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr142-coordinator",
    name: "PTR-142 Coordinator",
    email: "ptr142-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "ptr142-other-coordinator",
    name: "PTR-142 Other Coordinator",
    email: "ptr142-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr142-venue-staff",
    name: "PTR-142 Venue Staff",
    email: "ptr142-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAME = "PTR-142 Auditorium";
const userIds = Object.values(users).map(user => user.id);
const session = (user: (typeof users)[keyof typeof users]): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

describe("tentative hold expiry (PTR-142)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventId: number;
  let holdId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await clean();
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  async function clean() {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
  }

  beforeEach(async () => {
    await clean();
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "PTR-142 Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
        setupMinutes: 30,
        turnaroundMinutes: 45,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-142 Event",
        proposedDates: [{ start: "2099-06-15T09:00", end: "2099-06-15T12:00" }],
        expectedAttendance: 100,
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
    const hold = await handleCreateVenueHold(
      { venueId, eventId, date: "2099-06-15", startTime: "09:00", endTime: "12:00" },
      session(users.coordinator),
      database as never
    );
    holdId = hold.id;
  });

  const setExpiry = (expiresAt: string, actor = users.venueStaff) =>
    handleSetVenueHoldExpiry({ id: holdId, expiresAt }, session(actor), database as never);
  const setWarning = (warnAt: string | null, actor = users.coordinator) =>
    handleSetVenueHoldWarning({ id: holdId, warnAt }, session(actor), database as never);
  const notices = () =>
    database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
  const occupancy = () =>
    database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueHoldId, holdId));

  it("creates a hold with no expiry (legacy shape)", async () => {
    const [hold] = await database
      .select()
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, holdId));
    expect(hold).toMatchObject({ expiresAt: null, warnAt: null, expiryChangedById: null });
  });

  it("sets the expiry, records who and when, and tells the Coordinator (AC1, AC2)", async () => {
    const hold = await setExpiry("2099-06-10T12:00");
    expect(hold).toMatchObject({
      expiresAt: "2099-06-10 12:00:00",
      expiryChangedById: users.venueStaff.id,
      status: "held",
    });
    expect(hold.expiryChangedAt).toBeInstanceOf(Date);
    expect(await notices()).toMatchObject([
      {
        recipientId: users.coordinator.id,
        kind: "venue_hold_expiry_changed",
        payload: { action: "set", expiresAt: "2099-06-10 12:00:00", previousExpiresAt: null },
      },
    ]);
  });

  it("extends and shortens the expiry with the matching action (AC2, AC4)", async () => {
    await setExpiry("2099-06-10T12:00");
    await setExpiry("2099-06-12T12:00");
    await setExpiry("2099-06-11T12:00");
    const actions = (await notices()).map(row => (row.payload as { action: string }).action);
    expect(actions.toSorted()).toEqual(["extended", "set", "shortened"]);
  });

  it("raises nothing when the expiry does not change", async () => {
    await setExpiry("2099-06-10T12:00");
    await setExpiry("2099-06-10T12:00");
    expect(await notices()).toHaveLength(1);
  });

  it("keeps the stored warning instant when the expiry is extended (AC4)", async () => {
    await setExpiry("2099-06-10T12:00");
    await setWarning("2099-06-09T09:00");
    const extended = await setExpiry("2099-06-14T12:00");
    expect(extended.warnAt).toBe("2099-06-09 09:00:00");
    const last = (await notices()).map(row => row.payload as { warnAt: string | null });
    expect(last.at(-1)?.warnAt).toBe("2099-06-09 09:00:00");
  });

  it("leaves the occupancy row and buffers unchanged (AC5)", async () => {
    const before = await occupancy();
    expect(before).toHaveLength(1);
    await setExpiry("2099-06-10T12:00");
    await setExpiry("2099-06-12T12:00");
    expect(await occupancy()).toEqual(before);
    const [hold] = await database
      .select()
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, holdId));
    expect(hold).toMatchObject({ setupMinutes: 30, turnaroundMinutes: 45 });
  });

  it("refuses an expiry in the past or at or before the warning", async () => {
    await expect(setExpiry("2000-01-01T00:00")).rejects.toThrow(VENUE_HOLD_EXPIRY_PAST_MESSAGE);
    await setExpiry("2099-06-10T12:00");
    await setWarning("2099-06-09T09:00");
    await expect(setExpiry("2099-06-09T09:00")).rejects.toThrow(VENUE_HOLD_WARNING_ORDER_MESSAGE);
  });

  it("lets only the assigned Coordinator set the warning, before the expiry (AC3)", async () => {
    await expect(setWarning("2099-06-09T09:00", users.otherCoordinator)).rejects.toThrow(
      "Forbidden"
    );
    await setExpiry("2099-06-10T12:00");
    await expect(setWarning("2099-06-10T12:00")).rejects.toThrow(VENUE_HOLD_WARNING_ORDER_MESSAGE);
    expect((await setWarning("2099-06-09T09:00")).warnAt).toBe("2099-06-09 09:00:00");
    expect((await setWarning(null)).warnAt).toBeNull();
  });

  it("refuses a released hold and rejects malformed input", async () => {
    await database
      .update(schema.venueHolds)
      .set({ status: "released" })
      .where(eq(schema.venueHolds.id, holdId));
    await expect(setExpiry("2099-06-10T12:00")).rejects.toThrow("already been released");
    await expect(setExpiry("tomorrow")).rejects.toThrow("Enter a valid expiry date and time");
  });
});
