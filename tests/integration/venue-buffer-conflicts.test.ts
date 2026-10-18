// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import type { NotificationPayloads } from "#/features/notifications/message";
import {
  handleAmendVenueBooking,
  handleReleaseVenueBooking,
} from "#/features/venue-requests/bookings.server";
import {
  handleCreateVenueHold,
  handleReleaseVenueHold,
} from "#/features/venue-requests/holds.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleReleaseBlockedVenueBooking,
} from "#/features/venue-requests/requests.server";
import { handleRecordVenueBlock } from "#/features/venues/blocks.server";
import {
  handleGetVenue,
  handleGetVenueAvailability,
  handleSaveVenue,
} from "#/features/venues/records.server";
import type { OperatingHours } from "#/features/venues/schema";

const users = {
  organiser: {
    id: "ptr-132-organiser",
    name: "PTR-132 Organiser",
    email: "ptr-132-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinatorA: {
    id: "coord-buffer-a",
    name: "Coordinator A",
    email: "coord-buffer-a@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  coordinatorB: {
    id: "coord-buffer-b",
    name: "Coordinator B",
    email: "coord-buffer-b@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "staff-buffer-test",
    name: "Venue Staff",
    email: "staff-buffer-test@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const staff = session(users.venueStaff);
const coordA = session(users.coordinatorA);
const coordB = session(users.coordinatorB);

const VENUE_NAME = "PTR-132 Test Hall";
const DATE = "2026-11-10";
const BEFORE_DATE = new Date("2026-01-01T00:00:00+08:00");

const TEST_OPERATING_HOURS: OperatingHours = {
  mon: { opens: "08:00", closes: "22:00" },
  tue: { opens: "08:00", closes: "22:00" },
  wed: { opens: "08:00", closes: "22:00" },
  thu: { opens: "08:00", closes: "22:00" },
  fri: { opens: "08:00", closes: "22:00" },
  sat: { opens: "08:00", closes: "22:00" },
  sun: { opens: "08:00", closes: "22:00" },
};

describe("Venue buffer conflicts (PTR-132)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  async function cleanUp() {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
  }

  afterAll(async () => {
    await cleanUp();
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(u => u.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await cleanUp();
    const [created] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        operatingHours: TEST_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = created.id;
  });

  async function createEvent(
    name: string,
    assignee = users.coordinatorA.id,
    status: (typeof schema.eventRequestStatus.enumValues)[number] = "submitted"
  ) {
    const isCancelled = status === "cancelled";
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: assignee,
        assignedAt: new Date(),
        eventName: name,
        ...(isCancelled
          ? {
              cancelledById: assignee,
              cancelledByName: "Test Canceller",
              cancelledAt: new Date(),
            }
          : {}),
      })
      .returning({ id: schema.eventRequests.id });
    return event.id;
  }

  async function book(
    startTime: string,
    endTime: string,
    eventId?: number,
    date = DATE,
    actor = coordA
  ) {
    const eid = eventId ?? (await createEvent(`Booking ${startTime}-${endTime}`));
    const req = await handleCreateVenueRequest(
      { eventId: eid, venueId, date, startTime, endTime },
      actor,
      database as never
    );
    await handleApproveVenueRequest({ id: req.id }, staff, database as never);
    return { requestId: req.id, eventId: eid };
  }

  async function hold(
    startTime: string,
    endTime: string,
    eventId?: number,
    date = DATE,
    actor = coordA
  ) {
    const eid = eventId ?? (await createEvent(`Hold ${startTime}-${endTime}`, actor.id));
    const h = await handleCreateVenueHold(
      { eventId: eid, venueId, date, startTime, endTime },
      actor,
      database as never
    );
    return { holdId: h.id, eventId: eid };
  }

  async function block(startTime: string, endTime?: string, date = DATE) {
    return handleRecordVenueBlock(
      endTime === undefined
        ? { venueId, date, startTime, reason: "Maintenance block" }
        : { venueId, date, startTime, endDate: date, endTime, reason: "Maintenance block" },
      staff,
      database as never,
      BEFORE_DATE
    );
  }

  it("PTR-132-TC01: Buffer increase accepts save and lists conflicting approved bookings, active holds, and block-suspended pieces", async () => {
    await book("10:00", "11:00");
    await hold("11:30", "12:30");
    await book("13:00", "14:00");
    // Block covering the 13:00-14:00 booking suspends it
    await block("12:45", "14:15");

    // Save venue with setupMinutes: 30, turnaroundMinutes: 30
    const saved = await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 30,
        turnaroundMinutes: 30,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    expect(saved.bufferConflicts).toBeDefined();
    // 3 commitments overlap:
    // booking 10:00-11:00 (turnaround extends to 11:30, and hold setup extends to 11:00 -> overlap!)
    // hold 11:30-12:30 (turnaround extends to 13:00, and suspended piece setup extends to 12:30 -> overlap!)
    // suspended piece 13:00-14:00
    expect(saved.bufferConflicts).toHaveLength(3);
    const kinds = saved.bufferConflicts?.map(c => c.kind);
    expect(kinds).toContain("booking");
    expect(kinds).toContain("hold");
    expect(kinds).toContain("suspended");

    // Audit row inserted
    const auditRows = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, venueId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].setupMinutes).toBe(30);
    expect(auditRows[0].turnaroundMinutes).toBe(30);

    // Stored occupancy rows untouched
    const occupancyRows = await database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueId, venueId));
    const nonBlock = occupancyRows.filter(r => r.venueUnavailabilityId === null);
    for (const row of nonBlock) {
      expect(row.setupMinutes).toBe(0);
      expect(row.turnaroundMinutes).toBe(0);
    }
  });

  it("PTR-132-TC02: Retest uses each ledger row's own stored buffers and zero-buffer split pieces, flagging only newly created overlaps", async () => {
    // Set venue initial buffers to 30 / 30
    await database
      .update(schema.venues)
      .set({ setupMinutes: 30, turnaroundMinutes: 30 })
      .where(eq(schema.venues.id, venueId));

    // Booking A (10:00-11:00) stored occupied [09:30, 11:30)
    // Booking B (12:00-13:00) stored occupied [11:30, 13:30)
    // They touch at 11:30
    await book("10:00", "11:00");
    await book("12:00", "13:00");

    // A block [09:00, 10:30) splits Booking A into suspended piece [09:30, 10:30) (setup 0, turnaround 0)
    // and active remainder piece [10:30, 11:30) (setup 0, turnaround 0)
    await block("09:00", "10:30");

    // Pre-existing overlapping suspended pair on another date (2026-11-20) before the buffer change
    const suspEvent1 = await createEvent("Suspended Overlap 1");
    const suspEvent2 = await createEvent("Suspended Overlap 2");
    const [req1] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: suspEvent1,
        venueId,
        startsAt: "2026-11-20 10:00:00",
        endsAt: "2026-11-20 12:00:00",
        requestedById: users.coordinatorA.id,
        status: "approved",
      })
      .returning({ id: schema.venueRequests.id });
    const [req2] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: suspEvent2,
        venueId,
        startsAt: "2026-11-20 11:00:00",
        endsAt: "2026-11-20 13:00:00",
        requestedById: users.coordinatorA.id,
        status: "approved",
      })
      .returning({ id: schema.venueRequests.id });
    await database.insert(schema.venueOccupancy).values([
      {
        venueId,
        eventId: suspEvent1,
        venueRequestId: req1.id,
        startsAt: "2026-11-20 10:00:00",
        endsAt: "2026-11-20 12:00:00",
        setupMinutes: 30,
        turnaroundMinutes: 30,
        active: false,
        venueUnavailabilityId: null,
      },
      {
        venueId,
        eventId: suspEvent2,
        venueRequestId: req2.id,
        startsAt: "2026-11-20 11:00:00",
        endsAt: "2026-11-20 13:00:00",
        setupMinutes: 30,
        turnaroundMinutes: 30,
        active: false,
        venueUnavailabilityId: null,
      },
    ]);

    // Save venue with setupMinutes: 45, turnaroundMinutes: 30
    // Booking B with new setup starts at 11:15, overlapping Booking A's active split piece [10:30, 11:30)
    const saved = await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 45,
        turnaroundMinutes: 30,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    expect(saved.bufferConflicts).toHaveLength(2);
    // Exclude the pre-existing overlapping suspended pair on 2026-11-20
    expect(
      saved.bufferConflicts?.some(c => c.eventId === suspEvent1 || c.eventId === suspEvent2)
    ).toBe(false);
    // Booking A active piece and Booking B
    const flaggedEnds = saved.bufferConflicts?.map(c => c.endsAt) ?? [];
    expect(flaggedEnds.some(e => e.includes("11:30"))).toBe(true);
    expect(flaggedEnds.some(e => e.includes("13:00"))).toBe(true);
  });

  it("PTR-132-TC03: Buffer change that only touches at half-open boundary [) or reduces buffers flags no commitments", async () => {
    // 0 / 0 buffers
    // Booking A (10:00-11:00) and Booking B (12:00-13:00) sit 60 minutes apart
    await book("10:00", "11:00");
    await book("12:00", "13:00");

    // Save with 30 / 30: Booking A turnaround ends at 11:30, Booking B setup starts at 11:30 (touches at boundary 11:30)
    const savedTouch = await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 30,
        turnaroundMinutes: 30,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    expect(savedTouch.bufferConflicts).toEqual([]);

    // Reduce buffers to 15 / 15
    const savedReduce = await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 15,
        turnaroundMinutes: 15,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    expect(savedReduce.bufferConflicts).toEqual([]);
  });

  it("PTR-132-TC04: Unchanged buffer save (editing non-buffer venue fields) does not re-notify Coordinators", async () => {
    await book("10:00", "11:00");
    await book("11:30", "12:30");

    // First save: increase turnaround to 45 mins -> creates conflict
    await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    const initialNotices = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "venue_buffer_conflict"));
    const noticeCount = initialNotices.length;
    expect(noticeCount).toBeGreaterThan(0);

    const initialChanges = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, venueId));
    const changeCount = initialChanges.length;

    // Second save: change only location
    await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 2, Updated Location",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    const secondNotices = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "venue_buffer_conflict"));
    expect(secondNotices).toHaveLength(noticeCount);

    const secondChanges = await database
      .select()
      .from(schema.venueBufferChanges)
      .where(eq(schema.venueBufferChanges.venueId, venueId));
    expect(secondChanges).toHaveLength(changeCount);
  });

  it("PTR-132-TC05: Venue availability calendar marks flagged booking and hold periods with a buffer conflict indicator", async () => {
    await book("10:00", "11:00");
    await hold("11:30", "12:30");
    await book("16:00", "17:00");

    // Increase turnaround to 45
    await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    const avail = await handleGetVenueAvailability(
      { venueId, startDate: DATE, endDate: DATE },
      staff.id,
      database as never
    );

    expect(avail).not.toBeNull();
    const morningBooking = avail?.occupied.find(p => p.startsAt.includes("10:00"));
    const middayHold = avail?.occupied.find(p => p.startsAt.includes("11:30"));
    const afternoonBooking = avail?.occupied.find(p => p.startsAt.includes("16:00"));

    expect(morningBooking?.bufferConflict).toBe(true);
    expect(middayHold?.bufferConflict).toBe(true);
    expect(afternoonBooking?.bufferConflict).toBeUndefined();
  });

  it("PTR-132-TC06: Buffer save raises venue_buffer_conflict in-app notifications for assigned Coordinators of affected active events", async () => {
    const eventA = await createEvent("Event Alpha", users.coordinatorA.id);
    const eventB = await createEvent("Event Beta", users.coordinatorB.id);
    const eventC = await createEvent("Event Gamma Cancelled", users.coordinatorA.id);
    const eventD = await createEvent("Event Delta", users.coordinatorB.id);

    // Event A has two commitments on DATE:
    // 1) 10:00-11:00 (conflicts with Event B hold 11:30-12:30 under turnaround 45 mins)
    // 2) 14:00-15:00 (conflicts with Event D booking 15:30-16:30 under turnaround 45 mins)
    await book("10:00", "11:00", eventA);
    await hold("11:30", "12:30", eventB, DATE, coordB);
    await book("14:00", "15:00", eventA);
    await book("15:30", "16:30", eventD, DATE, coordB);

    // Cancelled Event C has a booking paired with an active booking
    await book("18:00", "19:00", eventC);
    await book("19:30", "20:30");

    await database
      .update(schema.eventRequests)
      .set({
        status: "cancelled",
        cancelledById: users.coordinatorA.id,
        cancelledByName: "Coordinator A",
        cancelledAt: new Date(),
      })
      .where(eq(schema.eventRequests.id, eventC));

    const saved = await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    // Cancelled event's commitment is excluded from saved.bufferConflicts
    expect(saved.bufferConflicts?.some(c => c.eventId === eventC)).toBe(false);

    // Cancelled event's commitment is excluded from handleGetVenueAvailability
    const avail = await handleGetVenueAvailability(
      { venueId, startDate: DATE, endDate: DATE },
      staff.id,
      database as never
    );
    const cancelledBooking = avail?.occupied.find(p => p.startsAt.includes("18:00"));
    expect(cancelledBooking?.bufferConflict).toBeUndefined();

    const notices = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "venue_buffer_conflict"));

    const coordANotice = notices.find(
      n => n.recipientId === users.coordinatorA.id && n.eventRequestId === eventA
    );
    const coordBNotice = notices.find(
      n => n.recipientId === users.coordinatorB.id && n.eventRequestId === eventB
    );
    const cancelledNotice = notices.find(n => n.eventRequestId === eventC);

    expect(coordANotice).toBeDefined();
    // Event A has two conflicting commitments: includes both periods in its notification payload (periods)
    const coordAPayload = coordANotice?.payload as
      | NotificationPayloads["venue_buffer_conflict"]
      | undefined;
    expect(coordAPayload?.periods).toHaveLength(2);
    expect(coordBNotice).toBeDefined();
    expect(cancelledNotice).toBeUndefined();
  });

  it("PTR-132-TC06b: Concurrently runs handleSaveVenue with an event update to verify event -> venue lock order completes without deadlock or error", async () => {
    const eventE = await createEvent("Event Concurrency", users.coordinatorA.id);
    await book("10:00", "11:00", eventE);
    await book("11:30", "12:30");

    const venueInput = {
      id: venueId,
      name: VENUE_NAME,
      location: "Level 1, Buffer Hall",
      maxCapacity: 100,
      setupMinutes: 30,
      turnaroundMinutes: 30,
      facilities: [],
      accessibilityFeatures: [],
      supportedLayouts: [],
      operatingHours: TEST_OPERATING_HOURS,
    };

    await expect(
      Promise.all([
        handleSaveVenue(venueInput, database as never, staff.id),
        database.transaction(async tx => {
          await tx
            .update(schema.eventRequests)
            .set({ assignedCoordinatorId: users.coordinatorB.id })
            .where(eq(schema.eventRequests.id, eventE));
        }),
      ])
    ).resolves.toBeDefined();
  });

  it("PTR-132-TC07: Resolving a flagged booking via Venue Staff release or amendment clears the conflict and preserves untouched rows", async () => {
    const DATE_1 = "2026-11-11";
    const DATE_2 = "2026-11-12";

    // Pair 1 on DATE_1
    const pair1_b1 = await book("10:00", "11:00", undefined, DATE_1);
    await book("11:30", "12:30", undefined, DATE_1);

    // Pair 2 on DATE_2
    const pair2_b1 = await book("10:00", "11:00", undefined, DATE_2);
    await book("11:30", "12:30", undefined, DATE_2);

    // Increase turnaround to 45
    await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    // Verify conflicts exist before resolution
    const venueBefore = await handleGetVenue({ id: venueId }, database as never);
    expect(venueBefore?.bufferConflicts).toHaveLength(4);

    // Amend Pair 1's first booking to 09:00-10:00
    await handleAmendVenueBooking(
      { id: pair1_b1.requestId, venueId, date: DATE_1, startTime: "09:00", endTime: "10:00" },
      staff,
      database as never
    );

    // Release Pair 2's first booking
    await handleReleaseVenueBooking(
      { id: pair2_b1.requestId, reason: "Resolved buffer conflict" },
      staff,
      database as never
    );

    // Verify conflicts cleared
    const venueAfter = await handleGetVenue({ id: venueId }, database as never);
    expect(venueAfter?.bufferConflicts).toEqual([]);

    // Availability for DATE_1 has no conflicts
    const avail1 = await handleGetVenueAvailability(
      { venueId, startDate: DATE_1, endDate: DATE_1 },
      staff.id,
      database as never
    );
    expect(avail1?.occupied.every(p => !p.bufferConflict)).toBe(true);

    // Availability for DATE_2 has no conflicts
    const avail2 = await handleGetVenueAvailability(
      { venueId, startDate: DATE_2, endDate: DATE_2 },
      staff.id,
      database as never
    );
    expect(avail2?.occupied.every(p => !p.bufferConflict)).toBe(true);
  });

  it("PTR-132-TC08: Resolving a flagged block-suspended booking or flagged hold via Coordinator release clears the conflict", async () => {
    const DATE_1 = "2026-11-13";
    const DATE_2 = "2026-11-14";

    // Date 1: booking suspended by block + approved booking
    const suspBooking = await book("10:00", "11:00", undefined, DATE_1);
    await block("09:45", "11:15", DATE_1);
    await book("11:30", "12:30", undefined, DATE_1);

    // Date 2: approved booking + active hold
    await book("10:00", "11:00", undefined, DATE_2);
    const holdDate2 = await hold("11:30", "12:30", undefined, DATE_2);

    // Increase turnaround to 45 mins
    await handleSaveVenue(
      {
        id: venueId,
        name: VENUE_NAME,
        location: "Level 1, Buffer Hall",
        maxCapacity: 100,
        setupMinutes: 0,
        turnaroundMinutes: 45,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: [],
        operatingHours: TEST_OPERATING_HOURS,
      },
      database as never,
      staff.id
    );

    const venueBefore = await handleGetVenue({ id: venueId }, database as never);
    expect(venueBefore?.bufferConflicts?.length).toBeGreaterThanOrEqual(4);

    // Call handleGetVenueAvailability for DATE_1 and DATE_2 BEFORE release
    const avail1Before = await handleGetVenueAvailability(
      { venueId, startDate: DATE_1, endDate: DATE_1 },
      staff.id,
      database as never
    );
    const suspPeriodBefore = avail1Before?.occupied.find(p => p.startsAt.includes("10:00"));
    expect(suspPeriodBefore?.bufferConflict).toBe(true);

    const avail2Before = await handleGetVenueAvailability(
      { venueId, startDate: DATE_2, endDate: DATE_2 },
      staff.id,
      database as never
    );
    const holdPeriodBefore = avail2Before?.occupied.find(p => p.startsAt.includes("11:30"));
    expect(holdPeriodBefore?.bufferConflict).toBe(true);

    // Coordinator releases blocked booking
    await handleReleaseBlockedVenueBooking(
      { id: suspBooking.requestId },
      coordA,
      database as never
    );

    // Coordinator releases hold
    await handleReleaseVenueHold({ id: holdDate2.holdId }, coordA, database as never);

    const venueAfter = await handleGetVenue({ id: venueId }, database as never);
    expect(venueAfter?.bufferConflicts).toEqual([]);

    // Call handleGetVenueAvailability for DATE_1 and DATE_2 AFTER release
    const avail1After = await handleGetVenueAvailability(
      { venueId, startDate: DATE_1, endDate: DATE_1 },
      staff.id,
      database as never
    );
    const suspPeriodAfter = avail1After?.occupied.find(p => p.startsAt.includes("10:00"));
    expect(suspPeriodAfter?.bufferConflict).toBeUndefined();

    const avail2After = await handleGetVenueAvailability(
      { venueId, startDate: DATE_2, endDate: DATE_2 },
      staff.id,
      database as never
    );
    const holdPeriodAfter = avail2After?.occupied.find(p => p.startsAt.includes("11:30"));
    expect(holdPeriodAfter?.bufferConflict).toBeUndefined();
  });
});
