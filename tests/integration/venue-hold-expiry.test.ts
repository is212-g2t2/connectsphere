// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import {
  handleSetVenueHoldExpiry,
  handleSetVenueHoldWarning,
} from "#/features/venue-requests/holds.server";
import {
  VENUE_HOLD_EXPIRY_BEFORE_WARNING_MESSAGE,
  VENUE_HOLD_EXPIRY_PAST_MESSAGE,
  VENUE_HOLD_WARNING_NEEDS_EXPIRY_MESSAGE,
  VENUE_HOLD_WARNING_ORDER_MESSAGE,
  VENUE_HOLD_WARNING_PAST_MESSAGE,
} from "#/features/venue-requests/schema";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { eventStatusColumns } from "./event-status";
import { HOLD_REQUEST_EXPIRY, requestAndPlaceHold } from "./hold-request";

/**
 * PTR-142: the expiry and warning of a tentative hold, tested through the handlers.
 *
 * Acceptance criteria:
 *   AC1: Venue Staff set the expiry. A hold without one is flagged. PTR-143's sweep ignores it.
 *   AC2: A change records the acting user and the time, and notifies the assigned Coordinator.
 *   AC3: The Coordinator sets the warning time and reads it back.
 *   AC4: An extension keeps the stored warning time and notifies the Coordinator.
 *   AC5: Setting or extending the expiry does not change the occupancy row or its buffers.
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
    const hold = await requestAndPlaceHold(
      { venueId, eventId, date: "2099-06-15", startTime: "09:00", endTime: "12:00" },
      session(users.coordinator),
      database as never,
      HOLD_REQUEST_EXPIRY
    );
    holdId = hold.id;
  });

  const setExpiry = (expiresAt: string, actor = users.venueStaff) =>
    handleSetVenueHoldExpiry({ id: holdId, expiresAt }, session(actor), database as never);
  const setWarning = (warnAt: string | null, actor = users.coordinator) =>
    handleSetVenueHoldWarning({ id: holdId, warnAt }, session(actor), database as never);
  /** A hold placed before this release may have no expiry. Clear the placed one to test that row. */
  const clearExpiry = () =>
    database
      .update(schema.venueHolds)
      .set({ expiresAt: null })
      .where(eq(schema.venueHolds.id, holdId));
  /** The expiry notices only. Placement and its request raise notices of their own kinds. */
  const notices = () =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, eventId),
          eq(schema.notifications.kind, "venue_hold_expiry_changed")
        )
      );
  const occupancy = () =>
    database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueHoldId, holdId));

  it("creates a held hold only by placement, with its expiry and placer", async () => {
    const [hold] = await database
      .select()
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, holdId));
    expect(hold).toMatchObject({
      status: "held",
      expiresAt: "2099-06-10 12:00:00",
      placedById: users.coordinator.id,
      warnAt: null,
      expiryChangedById: null,
    });
  });

  it("sets the expiry, records who and when, and tells the Coordinator (AC1, AC2)", async () => {
    await clearExpiry();
    const hold = await setExpiry("2099-06-10T12:00");
    expect(hold).toMatchObject({
      expiresAt: "2099-06-10 12:00:00",
      status: "held",
    });
    const [persisted] = await database
      .select()
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, holdId));
    expect(persisted.expiryChangedById).toBe(users.venueStaff.id);
    expect(persisted.expiryChangedAt).toBeInstanceOf(Date);
    expect(await notices()).toMatchObject([
      {
        recipientId: users.coordinator.id,
        kind: "venue_hold_expiry_changed",
        payload: { action: "set", expiresAt: "2099-06-10 12:00:00", previousExpiresAt: null },
      },
    ]);
  });

  it("extends and shortens the expiry with the matching action (AC2, AC4)", async () => {
    await clearExpiry();
    await setExpiry("2099-06-10T12:00");
    await setExpiry("2099-06-12T12:00");
    await setExpiry("2099-06-11T12:00");
    const actions = (await notices()).map(row => (row.payload as { action: string }).action);
    expect(actions.toSorted()).toEqual(["extended", "set", "shortened"]);
  });

  it("raises nothing when the expiry does not change", async () => {
    await clearExpiry();
    await setExpiry("2099-06-10T12:00");
    await setExpiry("2099-06-10T12:00");
    expect(await notices()).toHaveLength(1);
  });

  it("keeps the stored warning instant when the expiry is extended (AC4)", async () => {
    await clearExpiry();
    await setExpiry("2099-06-10T12:00");
    await setWarning("2099-06-09T09:00");
    const extended = await setExpiry("2099-06-14T12:00");
    expect(extended.warnAt).toBe("2099-06-09 09:00:00");
    const payloads = (await notices()).map(row => row.payload as { warnAt: string | null });
    expect(payloads.at(-1)?.warnAt).toBe("2099-06-09 09:00:00");
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
    await expect(setExpiry("2099-06-09T09:00")).rejects.toThrow(
      VENUE_HOLD_EXPIRY_BEFORE_WARNING_MESSAGE
    );
  });

  it("lets only the assigned Coordinator set the warning, before the expiry (AC3)", async () => {
    await setExpiry("2099-06-10T12:00");
    await expect(setWarning("2099-06-09T09:00", users.otherCoordinator)).rejects.toThrow(
      "Forbidden"
    );
    await expect(setWarning("2099-06-10T12:00")).rejects.toThrow(VENUE_HOLD_WARNING_ORDER_MESSAGE);
    expect((await setWarning("2099-06-09T09:00")).warnAt).toBe("2099-06-09 09:00:00");
    expect((await setWarning(null)).warnAt).toBeNull();
  });

  it("refuses a warning while the hold has no expiry, and still allows a clear", async () => {
    await clearExpiry();
    await expect(setWarning("2099-06-09T09:00")).rejects.toThrow(
      VENUE_HOLD_WARNING_NEEDS_EXPIRY_MESSAGE
    );
    expect((await setWarning(null)).warnAt).toBeNull();
  });

  it("refuses a warning in the past", async () => {
    await setExpiry("2099-06-10T12:00");
    await expect(setWarning("2000-01-01T00:00")).rejects.toThrow(VENUE_HOLD_WARNING_PAST_MESSAGE);
  });

  it("sets the expiry with no assigned Coordinator and raises no notification", async () => {
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: null })
      .where(eq(schema.eventRequests.id, eventId));
    expect(await setExpiry("2099-06-10T12:00")).toMatchObject({
      expiresAt: "2099-06-10 12:00:00",
    });
    expect(await notices()).toEqual([]);
  });

  it("refuses both writes on a cancelled event", async () => {
    await database
      .update(schema.eventRequests)
      .set(eventStatusColumns("cancelled", users.coordinator))
      .where(eq(schema.eventRequests.id, eventId));
    await expect(setExpiry("2099-06-10T12:00")).rejects.toThrow(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    await expect(setWarning("2099-06-09T09:00")).rejects.toThrow(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    const schedule = await handleGetVenueAvailability(
      { venueId, startDate: "2099-06-15", endDate: "2099-06-15" },
      users.coordinator.id,
      database as never
    );
    expect(schedule?.occupied.find(period => period.id === holdId)).toMatchObject({
      canChangeHold: false,
      canSetWarning: false,
    });
  });

  it("keeps the expiry control on a confirmed event's held hold", async () => {
    await database
      .update(schema.eventRequests)
      .set(eventStatusColumns("confirmed", users.coordinator))
      .where(eq(schema.eventRequests.id, eventId));
    const schedule = await handleGetVenueAvailability(
      { venueId, startDate: "2099-06-15", endDate: "2099-06-15" },
      users.coordinator.id,
      database as never
    );
    expect(schedule?.occupied.find(period => period.id === holdId)).toMatchObject({
      canChangeHold: true,
    });
    expect(await setExpiry("2099-06-10T12:00")).toMatchObject({
      expiresAt: "2099-06-10 12:00:00",
    });
  });

  it("shows the expiry to every viewer and the warning only to the assigned Coordinator (AC3)", async () => {
    await setExpiry("2099-06-10T12:00");
    await setWarning("2099-06-09T09:00");
    const view = async (viewer: (typeof users)[keyof typeof users]) => {
      const schedule = await handleGetVenueAvailability(
        { venueId, startDate: "2099-06-15", endDate: "2099-06-15" },
        viewer.id,
        database as never
      );
      return schedule?.occupied.find(period => period.id === holdId);
    };
    expect(await view(users.coordinator)).toMatchObject({
      expiresAt: "2099-06-10T12:00:00",
      warnAt: "2099-06-09T09:00:00",
      canSetWarning: true,
    });
    const others = await Promise.all([users.otherCoordinator, users.venueStaff].map(view));
    for (const period of others) {
      expect(period).toMatchObject({
        expiresAt: "2099-06-10T12:00:00",
        warnAt: null,
        canSetWarning: false,
      });
    }
  });

  it("refuses a released hold and rejects malformed input", async () => {
    await database
      .update(schema.venueHolds)
      .set({ status: "released" })
      .where(eq(schema.venueHolds.id, holdId));
    await expect(setExpiry("2099-06-10T12:00")).rejects.toThrow("This hold is no longer active.");
    await expect(setWarning("2099-06-09T09:00")).rejects.toThrow("This hold is no longer active.");
    await expect(setExpiry("tomorrow")).rejects.toThrow("Enter a valid expiry date and time");
  });
});
