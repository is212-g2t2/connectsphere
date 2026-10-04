// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleCountUnreadNotifications,
  handleListNotifications,
  handleMarkNotificationsRead,
  handleReadInbox,
} from "#/features/notifications/inbox.server";
import {
  NOTIFICATION_MAX_ATTEMPTS,
  deliverPendingNotifications,
} from "#/features/notifications/deliver.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

const sendEmail = vi.hoisted(() =>
  vi.fn<(to: string, subject: string, body: unknown, options?: unknown) => Promise<void>>(
    async () => {}
  )
);
vi.mock("#/lib/mailer.server", () => ({ sendEmail }));

type Database = ReturnType<typeof drizzle<typeof schema>>;

const users = {
  organiser: {
    id: "ntf-organiser",
    name: "Ntf Organiser",
    email: "ntf-organiser@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ntf-coordinator",
    name: "Ntf Coordinator",
    email: "ntf-coordinator@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "ntf-coordinator-2",
    name: "Ntf Other Coordinator",
    email: "ntf-coordinator-2@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ntf-venue-staff",
    name: "Ntf Venue Staff",
    email: "ntf-venue-staff@example.com",
    emailVerified: true,
    role: "venue_staff",
  },
  otherVenueStaff: {
    id: "ntf-venue-staff-2",
    name: "Ntf Other Venue Staff",
    email: "ntf-venue-staff-2@example.com",
    emailVerified: true,
    role: "venue_staff",
  },
} as const;

const session = (key: keyof typeof users): SessionUser => users[key];

describe("Notifications inbox and delivery (PTR-55)", () => {
  let pool: Pool;
  let database: Database;
  let eventId: number;
  let venueId: number;
  let venueRequestId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await cleanup();
    // The delivery worker claims every pending row, and this file runs against the suite's
    // shared database; start from an empty queue so counts are this suite's own.
    await database.delete(schema.notifications);
    await Promise.all(
      Object.values(users).map(u => database.insert(schema.user).values(u).onConflictDoNothing())
    );
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `Notification Hall ${Date.now()}`,
        location: "Building N",
        maxCapacity: 100,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        eventName: "Notification Gala",
        purpose: "PTR-55",
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
      })
      .returning();
    eventId = event.id;

    venueRequestId = crypto.randomUUID();
    await database.insert(schema.venueRequests).values({
      id: venueRequestId,
      eventId,
      venueId,
      requestedById: users.coordinator.id,
      startsAt: "2031-05-01 09:00:00",
      endsAt: "2031-05-01 17:00:00",
      status: "pending",
    });
  });

  afterAll(async () => {
    await cleanup();
    await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(u => u.id)
      )
    );
    await pool.end();
  });

  async function cleanup() {
    // Events cascade to venue requests, handovers and notifications; the queue is cleared
    // separately so the worker's counts are this suite's own.
    await database.delete(schema.notifications);
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
  }

  beforeEach(async () => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue(undefined);
    await database.delete(schema.notifications);
    await database
      .update(schema.venueRequests)
      .set({ status: "pending", assignedStaffId: null })
      .where(eq(schema.venueRequests.id, venueRequestId));
    // Tests may reassign the event; restore the suite's default so they stay independent.
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: users.coordinator.id })
      .where(eq(schema.eventRequests.id, eventId));
  });

  let timestampSeed = 0;
  function nextTimestamp() {
    timestampSeed += 1;
    return new Date(Date.UTC(2031, 0, 1, 0, 0, timestampSeed));
  }

  async function raise(
    recipientId: string,
    kind: typeof schema.notifications.$inferInsert.kind,
    payload: unknown,
    eventRequestId: number = eventId,
    createdAt: Date = nextTimestamp()
  ) {
    const [row] = await database
      .insert(schema.notifications)
      .values({ recipientId, eventRequestId, kind, payload: payload as never, createdAt })
      .returning();
    return row;
  }

  /** `count` confirmed-event rows for one recipient, a second apart from `baseMs`, oldest first. */
  async function raiseMany(recipientId: string, count: number, baseMs: number) {
    return database
      .insert(schema.notifications)
      .values(
        Array.from({ length: count }, (_, index) => ({
          recipientId,
          eventRequestId: eventId,
          kind: "event_confirmed" as const,
          payload: confirmedPayload() as never,
          createdAt: new Date(baseMs + index * 1_000),
        }))
      )
      .returning({ id: schema.notifications.id });
  }

  describe("inbox (AC1–AC5)", () => {
    it("lists the caller's notifications newest first and nobody else's (AC1, AC3)", async () => {
      const coordinator = session("coordinator");
      const oldest = await raise(coordinator.id, "event_confirmed", confirmedPayload(), eventId);
      const middle = await raise(
        coordinator.id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      const newest = await raise(
        coordinator.id,
        "equipment_released",
        {
          eventName: "Notification Gala",
          item: "Mixer",
          requestedQuantity: 2,
          previousQuantity: 2,
          quantity: 0,
          arrangementStatus: "requested",
          unavailableReason: null,
          actorName: "Tara",
        },
        eventId
      );
      await raise(session("organiser").id, "event_confirmed", confirmedPayload(), eventId);

      const items = await handleListNotifications(coordinator, database);
      expect(items.map(item => item.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(items).toHaveLength(3);
    });

    it("links the organiser to the event and the coordinator to coordination (AC2, AC4)", async () => {
      await raise(session("organiser").id, "event_confirmed", confirmedPayload(), eventId);
      await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );

      const organiserItems = await handleListNotifications(session("organiser"), database);
      expect(organiserItems[0]).toMatchObject({
        summary: "Event confirmed: Notification Gala",
        href: `/event-requests/${eventId}`,
      });
      expect(Number.isNaN(Date.parse(organiserItems[0].createdAt))).toBe(false);

      const coordinatorItems = await handleListNotifications(session("coordinator"), database);
      expect(coordinatorItems[0]).toMatchObject({
        summary: "Clarification replied: Notification Gala",
        href: `/coordination/${eventId}`,
      });
    });

    it("neutralises a row whose event the caller no longer reaches (AC5)", async () => {
      // The other Coordinator is not assigned to this event, so it is not in reach.
      await raise(session("otherCoordinator").id, "event_confirmed", confirmedPayload(), eventId);

      const items = await handleListNotifications(session("otherCoordinator"), database);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ summary: null, href: null });
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain("Notification Gala");
      expect(serialized).not.toContain("event_confirmed");
      expect(serialized).not.toContain("confirmation");
    });

    it("keeps a live handover offer visible before the recipient is assigned, and hides a stale one", async () => {
      const [handover] = await database
        .insert(schema.eventHandovers)
        .values({
          eventRequestId: eventId,
          fromCoordinatorId: users.coordinator.id,
          toCoordinatorId: users.otherCoordinator.id,
        })
        .returning();
      await raise(
        session("otherCoordinator").id,
        "handover_requested",
        { eventName: "Notification Gala", fromName: "Ntf Coordinator" },
        eventId
      );

      const live = await handleListNotifications(session("otherCoordinator"), database);
      expect(live[0]).toMatchObject({
        summary: "Handover requested: Notification Gala",
        href: "/coordination",
      });

      // A direct reassignment vacates the offer without answering it: the event no longer
      // belongs to the Coordinator who offered it, so the notification must not leak the event.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: null })
        .where(eq(schema.eventRequests.id, eventId));
      try {
        const stale = await handleListNotifications(session("otherCoordinator"), database);
        expect(stale[0]).toMatchObject({ summary: null, href: null });
      } finally {
        await database
          .update(schema.eventRequests)
          .set({ assignedCoordinatorId: users.coordinator.id })
          .where(eq(schema.eventRequests.id, eventId));
        await database
          .delete(schema.eventHandovers)
          .where(eq(schema.eventHandovers.id, handover.id));
      }
    });

    it("shows venue staff the venue line, links a pending request, and never names the event", async () => {
      await raise(
        session("venueStaff").id,
        "venue_booking_requested",
        {
          venueRequestId,
          venueName: "Notification Hall",
          startsAt: "2031-05-01 09:00:00",
          endsAt: "2031-05-01 17:00:00",
          expectedAttendance: 50,
          layout: "Theatre",
          accessibilityRequirements: "",
          requiredFacilities: "",
        },
        eventId
      );

      const pendingItems = await handleListNotifications(session("venueStaff"), database);
      expect(pendingItems[0]).toMatchObject({
        summary: "Venue booking requested: Notification Hall",
        href: `/venue-requests/${venueRequestId}`,
      });
      expect(JSON.stringify(pendingItems)).not.toContain("Notification Gala");

      // Once another staff member settles it, the deciding member stays connected and the link
      // moves to the bookings list; a released or rejected request has no page to send them to.
      await database
        .update(schema.venueRequests)
        .set({ status: "approved", assignedStaffId: users.venueStaff.id })
        .where(eq(schema.venueRequests.id, venueRequestId));
      const settled = await handleListNotifications(session("venueStaff"), database);
      expect(settled[0]?.href).toBe("/venue-bookings");

      await database
        .update(schema.venueRequests)
        .set({ status: "released", releaseReason: "Maintenance" })
        .where(eq(schema.venueRequests.id, venueRequestId));
      const released = await handleListNotifications(session("venueStaff"), database);
      expect(released[0]).toMatchObject({
        summary: "Venue booking requested: Notification Hall",
        href: null,
      });

      await database
        .update(schema.venueRequests)
        .set({ status: "rejected", rejectionReason: "Not available" })
        .where(eq(schema.venueRequests.id, venueRequestId));
      const rejected = await handleListNotifications(session("venueStaff"), database);
      expect(rejected[0]).toMatchObject({
        summary: "Venue booking requested: Notification Hall",
        href: null,
      });
    });

    it("caps the inbox at 50 rows, newest first", async () => {
      const coordinator = session("coordinator");
      // One bulk insert with explicit increasing instants; 51 rows must exceed the 50-row page.
      const rows = await raiseMany(coordinator.id, 51, Date.UTC(2032, 0, 1, 0, 0, 0));

      const items = await handleListNotifications(coordinator, database);
      expect(items).toHaveLength(50);
      expect(items[0].id).toBe(rows[50].id);
      expect(items.map(item => item.id)).not.toContain(rows[0].id);
    });

    it("breaks a createdAt tie by id, later insert first", async () => {
      const coordinator = session("coordinator");
      const at = new Date(Date.UTC(2031, 6, 1, 12, 0, 0));
      const first = await raise(coordinator.id, "event_confirmed", confirmedPayload(), eventId, at);
      const second = await raise(
        coordinator.id,
        "event_confirmed",
        confirmedPayload(),
        eventId,
        at
      );

      const items = await handleListNotifications(coordinator, database);
      expect(items.map(item => item.id)).toEqual([second.id, first.id]);
    });

    it("neutralises venue staff who did not decide the request (intended: reachability is the caller's current event relationship, not the notification's subject)", async () => {
      const requestedPayload = {
        venueRequestId,
        venueName: "Notification Hall",
        startsAt: "2031-05-01 09:00:00",
        endsAt: "2031-05-01 17:00:00",
        expectedAttendance: 50,
        layout: "Theatre",
        accessibilityRequirements: "",
        requiredFacilities: "",
      };
      await raise(session("venueStaff").id, "venue_booking_requested", requestedPayload, eventId);
      await raise(
        session("otherVenueStaff").id,
        "venue_booking_requested",
        requestedPayload,
        eventId
      );
      await database
        .update(schema.venueRequests)
        .set({ status: "approved", assignedStaffId: users.venueStaff.id })
        .where(eq(schema.venueRequests.id, venueRequestId));

      const other = await handleListNotifications(session("otherVenueStaff"), database);
      expect(other).toHaveLength(1);
      expect(other[0]).toMatchObject({ summary: null, href: null });

      const decider = await handleListNotifications(session("venueStaff"), database);
      expect(decider[0]).toMatchObject({
        summary: "Venue booking requested: Notification Hall",
        href: "/venue-bookings",
      });
    });

    it("neutralises a reassigned raiser (intended: reachability is the caller's current event relationship, not the notification's subject)", async () => {
      // The raiser is the assigned Coordinator when the decision lands...
      await raise(
        session("coordinator").id,
        "venue_booking_approved",
        {
          venueRequestId,
          eventName: "Notification Gala",
          venueName: "Notification Hall",
          startsAt: "2031-05-01 09:00:00",
          endsAt: "2031-05-01 17:00:00",
        },
        eventId
      );
      // ...and is then reassigned away from the event.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));

      const items = await handleListNotifications(session("coordinator"), database);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ summary: null, href: null });
    });
  });

  describe("read state (PTR-56)", () => {
    it("reads the listed rows and the global unread count together for the page (AC2)", async () => {
      const coordinator = session("coordinator");
      await raiseMany(coordinator.id, 52, Date.UTC(2034, 0, 1, 0, 0, 0));

      const inbox = await handleReadInbox(coordinator, database as never);
      // Counted past the page: a count derived from the listed rows would say 50.
      expect(inbox.notifications).toHaveLength(50);
      expect(inbox.unreadCount).toBe(52);
    });

    it("starts every new notification unread and counts it (AC1, AC2)", async () => {
      const coordinator = session("coordinator");
      const row = await raise(coordinator.id, "event_confirmed", confirmedPayload());

      expect(row.readAt).toBeNull();
      const items = await handleListNotifications(coordinator, database);
      expect(items.map(item => item.read)).toEqual([false]);
      expect(await handleCountUnreadNotifications(coordinator, database)).toBe(1);
    });

    it("marks one read, keeps an earlier first read time, and leaves the rest unread (AC3, AC4)", async () => {
      const coordinator = session("coordinator");
      const firstRead = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
      const alreadyRead = await raise(coordinator.id, "event_confirmed", confirmedPayload());
      await database
        .update(schema.notifications)
        .set({ readAt: firstRead })
        .where(eq(schema.notifications.id, alreadyRead.id));
      const older = await raise(coordinator.id, "event_confirmed", confirmedPayload());
      const newer = await raise(coordinator.id, "event_confirmed", confirmedPayload());

      // Marking the newest by id must leave the older unread row alone, unlike a mark-through.
      await handleMarkNotificationsRead({ id: newer.id }, coordinator, database as never);
      await handleMarkNotificationsRead({ id: alreadyRead.id }, coordinator, database as never);

      const [kept] = await database
        .select({ readAt: schema.notifications.readAt })
        .from(schema.notifications)
        .where(eq(schema.notifications.id, alreadyRead.id));
      expect(kept.readAt).toEqual(firstRead);
      const items = await handleListNotifications(coordinator, database);
      expect(items.map(item => [item.id, item.read])).toEqual([
        [newer.id, true],
        [older.id, false],
        [alreadyRead.id, true],
      ]);
      expect(await handleCountUnreadNotifications(coordinator, database)).toBe(1);
    });

    it("leaves another user's notification unread when asked to mark it", async () => {
      const organiserRow = await raise(
        session("organiser").id,
        "event_confirmed",
        confirmedPayload()
      );

      await handleMarkNotificationsRead(
        { id: organiserRow.id },
        session("coordinator"),
        database as never
      );

      expect(await handleCountUnreadNotifications(session("organiser"), database)).toBe(1);
    });

    it("marks all read up to the cutoff id, beyond the 50-row page, and only the caller's (AC3)", async () => {
      const coordinator = session("coordinator");
      // Raised first, so its id sits below the cutoff: only the recipient scope can spare it.
      await raise(session("organiser").id, "event_confirmed", confirmedPayload());
      const rows = await raiseMany(coordinator.id, 52, Date.UTC(2033, 0, 1, 0, 0, 0));
      // The count is not capped by the page.
      expect(await handleCountUnreadNotifications(coordinator, database)).toBe(52);

      // rows[51] stands in for a notification raised after the page rendered: above the cutoff.
      const cutoff = rows[50].id;
      await handleMarkNotificationsRead({ throughId: cutoff }, coordinator, database as never);

      expect(await handleCountUnreadNotifications(coordinator, database)).toBe(1);
      expect(await handleCountUnreadNotifications(session("organiser"), database)).toBe(1);
      const items = await handleListNotifications(coordinator, database);
      expect(items.filter(item => !item.read).map(item => item.id)).toEqual([rows[51].id]);
    });

    it("keeps the read state of a neutralised or unparseable row without exposing anything else", async () => {
      const otherCoordinator = session("otherCoordinator");
      const unreachable = await raise(otherCoordinator.id, "event_confirmed", confirmedPayload());
      const unparseable = await raise(otherCoordinator.id, "event_confirmed", {});
      await handleMarkNotificationsRead(
        { throughId: unparseable.id },
        otherCoordinator,
        database as never
      );

      const items = await handleListNotifications(otherCoordinator, database);
      expect(items).toEqual([
        {
          id: unparseable.id,
          createdAt: unparseable.createdAt.toISOString(),
          read: true,
          summary: null,
          href: null,
        },
        {
          id: unreachable.id,
          createdAt: unreachable.createdAt.toISOString(),
          read: true,
          summary: null,
          href: null,
        },
      ]);
    });
  });

  describe("delivery worker", () => {
    it("sends pending rows oldest first, marks them emailed, and passes an idempotency key", async () => {
      const first = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      const second = await raise(
        session("organiser").id,
        "event_confirmed",
        confirmedPayload(),
        eventId
      );

      const result = await deliverPendingNotifications(database as never);

      expect(result).toEqual({ sent: 2, failed: 0, pending: 0 });
      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(sendEmail.mock.calls[0][0]).toBe(users.coordinator.email);
      expect(sendEmail.mock.calls[0][1]).toBe("Clarification replied: Notification Gala");
      expect(sendEmail.mock.calls[0][3]).toEqual({ idempotencyKey: `notification-${first.id}` });
      expect(sendEmail.mock.calls[1][0]).toBe(users.organiser.email);
      expect(sendEmail.mock.calls[1][3]).toEqual({ idempotencyKey: `notification-${second.id}` });

      const rows = await database
        .select()
        .from(schema.notifications)
        .where(inArray(schema.notifications.id, [first.id, second.id]));
      for (const row of rows) {
        expect(row.emailedAt).not.toBeNull();
        expect(row.claimedAt).toBeNull();
        expect(row.failedAt).toBeNull();
        // The claim increments the version the ownership guard compares against.
        expect(row.emailAttempts).toBe(1);
      }
    });

    it("backs a failed row off with a sanitised error and skips it until it is due", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      sendEmail.mockRejectedValueOnce(new Error("SMTP down for ntf-coordinator@example.com"));

      const first = await deliverPendingNotifications(database as never);
      expect(first).toEqual({ sent: 0, failed: 1, pending: 1 });

      const [afterFirst] = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, row.id));
      expect(afterFirst.emailedAt).toBeNull();
      expect(afterFirst.failedAt).toBeNull();
      expect(afterFirst.emailAttempts).toBe(1);
      expect(afterFirst.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      // Only the error's name is persisted; the message can echo the recipient address.
      expect(afterFirst.lastEmailError).toBe("Error");
      expect(JSON.stringify(afterFirst)).not.toContain("ntf-coordinator@example.com");

      const second = await deliverPendingNotifications(database as never);
      expect(second).toEqual({ sent: 0, failed: 0, pending: 1 });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("dead-letters a row once its attempt budget is spent", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      await database
        .update(schema.notifications)
        .set({ emailAttempts: NOTIFICATION_MAX_ATTEMPTS - 1 })
        .where(eq(schema.notifications.id, row.id));
      sendEmail.mockRejectedValueOnce(new Error("Still down"));

      const result = await deliverPendingNotifications(database as never);
      expect(result).toEqual({ sent: 0, failed: 1, pending: 0 });
      expect(sendEmail).toHaveBeenCalledTimes(1);

      const [dead] = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, row.id));
      expect(dead.failedAt).not.toBeNull();
      expect(dead.emailAttempts).toBe(NOTIFICATION_MAX_ATTEMPTS);

      const next = await deliverPendingNotifications(database as never);
      expect(next).toEqual({ sent: 0, failed: 0, pending: 0 });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("skips a row another run is still holding, and retries one whose lease expired", async () => {
      const held = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      const expired = await raise(
        session("organiser").id,
        "event_confirmed",
        confirmedPayload(),
        eventId
      );
      await database
        .update(schema.notifications)
        .set({ claimedAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.notifications.id, held.id));
      await database
        .update(schema.notifications)
        .set({ claimedAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(schema.notifications.id, expired.id));

      const result = await deliverPendingNotifications(database as never);
      expect(result).toEqual({ sent: 1, failed: 0, pending: 1 });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0]).toBe(users.organiser.email);
    });

    it("dead-letters a payload no renderer understands instead of retrying it forever", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { not: "a valid payload" },
        eventId
      );

      const result = await deliverPendingNotifications(database as never);
      expect(result).toEqual({ sent: 0, failed: 1, pending: 0 });
      expect(sendEmail).not.toHaveBeenCalled();

      const [dead] = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, row.id));
      expect(dead.failedAt).not.toBeNull();
      expect(dead.lastEmailError).toBe("UnreadableNotification");
    });

    it("skips a row another run is holding, and delivers it once the lock is released", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );

      // A second connection holds the row the way an overlapping worker's claim would. Without
      // FOR UPDATE SKIP LOCKED, the claim below would block on it until the test times out.
      const lockPool = new Pool({ connectionString: process.env.DATABASE_URL });
      const client = await lockPool.connect();
      try {
        await client.query("begin");
        await client.query("select id from notifications where id = $1 for update", [row.id]);

        const held = await deliverPendingNotifications(database as never);
        expect(held).toEqual({ sent: 0, failed: 0, pending: 1 });
        expect(sendEmail).not.toHaveBeenCalled();
      } finally {
        await client.query("rollback");
        client.release();
        await lockPool.end();
      }

      const after = await deliverPendingNotifications(database as never);
      expect(after).toEqual({ sent: 1, failed: 0, pending: 0 });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("refuses a terminal write when the claim was taken over mid-send", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      sendEmail.mockImplementationOnce(async () => {
        await database
          .update(schema.notifications)
          .set({
            emailAttempts: sql`${schema.notifications.emailAttempts} + 1`,
            claimedAt: new Date(),
          })
          .where(eq(schema.notifications.id, row.id));
        throw new Error("late provider failure");
      });

      const result = await deliverPendingNotifications(database as never);
      expect(result).toEqual({ sent: 0, failed: 0, pending: 1 });

      const [kept] = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, row.id));
      expect(kept.claimedAt).not.toBeNull();
      expect(kept.failedAt).toBeNull();
      expect(kept.emailedAt).toBeNull();
    });

    it("refuses to mark a send when the claim was taken over mid-send", async () => {
      const row = await raise(
        session("coordinator").id,
        "clarification_replied",
        { eventName: "Notification Gala", question: "q", body: "b" },
        eventId
      );
      sendEmail.mockImplementationOnce(async () => {
        await database
          .update(schema.notifications)
          .set({
            emailAttempts: sql`${schema.notifications.emailAttempts} + 1`,
            claimedAt: new Date(),
          })
          .where(eq(schema.notifications.id, row.id));
        // Resolves, so the worker reaches its success write with a stale claim version.
      });

      const result = await deliverPendingNotifications(database as never);
      expect(result).toEqual({ sent: 0, failed: 0, pending: 1 });

      const [kept] = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, row.id));
      expect(kept.emailedAt).toBeNull();
      expect(kept.claimedAt).not.toBeNull();
      expect(kept.failedAt).toBeNull();
    });
  });
});

function confirmedPayload() {
  return {
    eventName: "Notification Gala",
    venueName: "Notification Hall",
    startsAt: "2031-05-01 09:00:00",
    endsAt: "2031-05-01 17:00:00",
    equipment: [],
  };
}
