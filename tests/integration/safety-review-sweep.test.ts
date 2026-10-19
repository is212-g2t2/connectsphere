// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { arrangementFingerprint } from "#/features/safety-reviews/fingerprint.server";
import { handleListSafetyReviews } from "#/features/safety-reviews/reviews.server";
import { sweepSafetyReviews } from "#/features/safety-reviews/sweep.server";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { parseNotificationPayload } from "#/features/notifications/message";
import { render } from "@react-email/components";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import * as notificationWriter from "#/features/notifications/raise.server";

const organiser = { id: "test-user-2" };
const coordinator = { id: "seed-coordinator-1", name: "Seeded Event Coordinator" };
describe("automatic safety review sweep", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  const created: number[] = [];
  const now = new Date("2040-01-01T00:00:00Z");
  const sweep = () => sweepSafetyReviews(database as never, now);
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: "Sweep test venue",
        location: "Singapore",
        maxCapacity: 100,
        facilities: [],
        accessibilityFeatures: [],
        supportedLayouts: ["theatre"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning();
    venueId = venue.id;
    await database.insert(schema.user).values({
      id: "sweep-safety",
      name: "Second safety officer",
      email: "sweep-safety@x.test",
      emailVerified: true,
      role: "safety_officer",
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!created.length) return;
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });
  afterAll(async () => {
    await database.delete(schema.user).where(eq(schema.user.id, "sweep-safety"));
    await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    await pool.end();
  });
  async function createEvent(
    status: (typeof schema.eventRequestStatus.enumValues)[number] = "approved",
    options: { coordinatorId?: string | null } = {}
  ) {
    const decided = !["draft", "submitted", "under_review", "awaiting_organiser"].includes(status);
    const confirmed = status === "confirmed";
    const completed = status === "completed";
    const cancelled = status === "cancelled";
    const coordinatorId =
      options.coordinatorId === undefined ? coordinator.id : options.coordinatorId;
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        ...(coordinatorId === null ? {} : { assignedAt: new Date() }),
        ...(decided
          ? {
              decisionReason: status === "rejected" ? "Not suitable" : null,
              decidedByCoordinatorId: coordinator.id,
              decidedByCoordinatorName: coordinator.name,
              decidedAt: new Date(),
            }
          : {}),
        ...(confirmed
          ? {
              confirmedById: coordinator.id,
              confirmedByName: coordinator.name,
              confirmedAt: new Date("2030-01-01T00:00:00Z"),
            }
          : {}),
        ...(completed
          ? {
              completedById: coordinator.id,
              completedByName: coordinator.name,
              completedAt: new Date("2030-01-02T00:00:00Z"),
            }
          : {}),
        ...(cancelled
          ? {
              cancelledById: coordinator.id,
              cancelledByName: coordinator.name,
              cancelledAt: new Date(),
            }
          : {}),
        equipmentArrangementsCompletedAt: new Date(),
        eventName: `Safety review test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
        expectedAttendance: 10,
        eventType: "Conference",
        roomLayoutPreference: "Theatre",
      })
      .returning({ id: schema.eventRequests.id });
    created.push(row.id);
    return row.id;
  }

  async function createBooking(eventId: number, status: "approved" | "pending" = "approved") {
    const startsAt = "2041-03-10 09:00:00";
    const endsAt = "2041-03-10 12:30:00";
    const [row] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId,
        venueId,
        requestedById: coordinator.id,
        startsAt,
        endsAt,
        status,
        expectedAttendance: 10,
        layout: "Theatre",
        accessibilityRequirements: "",
        requiredFacilities: "",
      })
      .returning({ id: schema.venueRequests.id });
    // An approved booking occupies the venue through its ledger row, as the approval path writes
    // it. A venue block then suspends the row, which the review list and the fingerprint read.
    if (status === "approved") {
      await database.insert(schema.venueOccupancy).values({
        venueId,
        eventId,
        venueRequestId: row.id,
        startsAt,
        endsAt,
        setupMinutes: 0,
        turnaroundMinutes: 0,
      });
    }
    return row.id;
  }

  async function createLine(
    eventId: number,
    item: string,
    arrangementStatus: "requested" | "reserved" | "not_required" | "unavailable",
    quantity = 1
  ) {
    await database.insert(schema.equipmentRequests).values({
      id: crypto.randomUUID(),
      eventId,
      item,
      quantity,
      arrangementStatus,
      ...(arrangementStatus === "unavailable" ? { unavailableReason: "Loaned out" } : {}),
    });
  }

  /** Create a review with the event's current fingerprint unless a stale one is asked for. */
  async function createReview(eventId: number, fingerprint?: string) {
    const covered = fingerprint ?? (await currentFingerprint(eventId));
    const [row] = await database
      .insert(schema.safetyReviews)
      .values({ eventRequestId: eventId, fingerprint: covered })
      .returning();
    return row;
  }

  const currentFingerprint = (eventId: number) =>
    arrangementFingerprint(database as never, eventId).then(value => {
      if (value === null) throw new Error(`No event ${eventId}`);
      return value;
    });

  const readEvent = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const notices = (id: number) =>
    database.select().from(schema.notifications).where(eq(schema.notifications.eventRequestId, id));
  const reviews = (id: number) =>
    database.select().from(schema.safetyReviews).where(eq(schema.safetyReviews.eventRequestId, id));
  async function decideReview(id: number, state: "approved" | "rejected" | "changes_requested") {
    const review = await createReview(id);
    await database
      .update(schema.safetyReviews)
      .set({
        state,
        decidedById: "sweep-safety",
        decidedByName: "Officer",
        decidedAt: now,
        comments: "Check exits",
      })
      .where(eq(schema.safetyReviews.id, review.id));
    return review;
  }

  test("creates one review and one notice per Safety Officer across overlapping and repeated runs", async () => {
    const id = await createEvent();
    await createBooking(id);
    await Promise.all([sweep(), sweep()]);
    await sweep();
    expect(await reviews(id)).toHaveLength(1);
    const rows = await notices(id);
    const officers = await database
      .select()
      .from(schema.user)
      .where(eq(schema.user.role, "safety_officer"));
    expect(rows.map(row => row.recipientId).toSorted()).toEqual(
      officers.map(row => row.id).toSorted()
    );
    expect(rows.every(row => row.kind === "safety_review_requested")).toBe(true);
    const payload = parseNotificationPayload(rows[0].kind, rows[0].payload);
    expect(payload).not.toBeNull();
    if (!payload) throw new Error("Notification payload did not parse");
    const email = renderNotificationEmail({ ...payload, eventRequestId: id });
    expect(await render(email.element)).toContain("awaits your safety review");
  });

  test("leaves a stale pending review withdrawn while incomplete, then refreshes the same row without notice", async () => {
    const id = await createEvent("planning");
    await createBooking(id);
    await sweep();
    const [original] = await reviews(id);
    const raised = (await notices(id)).length;
    await createLine(id, "Projector", "requested");
    await sweep();
    expect((await reviews(id))[0].fingerprint).toBe(original.fingerprint);
    expect(
      (await handleListSafetyReviews(database as never)).find(row => row.eventId === id)?.current
    ).toBe(false);
    await database
      .update(schema.equipmentRequests)
      .set({ arrangementStatus: "not_required" })
      .where(eq(schema.equipmentRequests.eventId, id));
    await sweep();
    const [updated] = await reviews(id);
    expect(updated.id).toBe(original.id);
    expect(updated.fingerprint).toBe(await currentFingerprint(id));
    expect(updated.refreshedAt).not.toBeNull();
    expect(
      (await handleListSafetyReviews(database as never)).find(row => row.eventId === id)
    ).toMatchObject({ current: true, updated: true });
    expect(await notices(id)).toHaveLength(raised);
  });

  test.each(["approved", "rejected", "changes_requested"] as const)(
    "preserves a current %s decision and replaces it only after material change",
    async state => {
      const id = await createEvent();
      await createBooking(id);
      await decideReview(id, state);
      await sweep();
      expect(await reviews(id)).toHaveLength(1);
      expect(await notices(id)).toHaveLength(0);
      await database
        .update(schema.eventRequests)
        .set({ roomLayoutPreference: "Banquet" })
        .where(eq(schema.eventRequests.id, id));
      await sweep();
      expect(await reviews(id)).toHaveLength(2);
      expect((await reviews(id)).filter(row => row.state === "pending")).toHaveLength(1);
    }
  );

  test.each(["approved", "planning"])(
    "does not create a review for incomplete %s arrangements",
    async status => {
      const id = await createEvent(status as "approved" | "planning");
      await sweep();
      expect(await reviews(id)).toHaveLength(0);
      await createBooking(id);
      await createLine(id, "Projector", "reserved");
      await database
        .update(schema.eventRequests)
        .set({ equipmentArrangementsCompletedAt: null })
        .where(eq(schema.eventRequests.id, id));
      await sweep();
      expect(await reviews(id)).toHaveLength(0);
    }
  );

  test.each(["cancelled", "completed", "rejected"] as const)("skips %s events", async status => {
    const id = await createEvent(status);
    await createBooking(id);
    await createReview(id, "old");
    await sweep();
    expect((await reviews(id))[0].fingerprint).toBe("old");
    expect(await notices(id)).toHaveLength(0);
    expect((await readEvent(id)).status).toBe(status);
  });

  test.each(["approved", "planning", "confirmed"] as const)(
    "skips a started multi-session %s event",
    async status => {
      const id = await createEvent(status);
      const booking = await createBooking(id);
      await database
        .update(schema.venueRequests)
        .set({ startsAt: "2039-01-01 09:00:00" })
        .where(eq(schema.venueRequests.id, booking));
      await database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId: id,
        venueId,
        requestedById: coordinator.id,
        startsAt: "2042-01-01 09:00:00",
        endsAt: "2042-01-01 10:00:00",
        status: "approved",
      });
      await database
        .update(schema.venueOccupancy)
        .set({ active: false })
        .where(eq(schema.venueOccupancy.venueRequestId, booking));
      await createReview(id, "old");
      await sweep();
      expect((await reviews(id))[0].fingerprint).toBe("old");
      expect((await readEvent(id)).status).toBe(status);
      expect(await notices(id)).toHaveLength(0);
    }
  );

  test("skips an event that started before the default clock", async () => {
    const id = await createEvent("approved");
    const booking = await createBooking(id);
    await database
      .update(schema.venueRequests)
      .set({ startsAt: "2020-01-01 09:00:00", endsAt: "2020-01-01 12:00:00" })
      .where(eq(schema.venueRequests.id, booking));
    await sweepSafetyReviews(database as never);
    expect(await reviews(id)).toHaveLength(0);
    expect(await notices(id)).toHaveLength(0);
  });

  test("reverts a stale confirmed approval once, clears its stamp, and notifies its Coordinator", async () => {
    const id = await createEvent("confirmed");
    await createBooking(id);
    await decideReview(id, "approved");
    await database
      .update(schema.eventRequests)
      .set({ roomLayoutPreference: "Banquet" })
      .where(eq(schema.eventRequests.id, id));
    await Promise.all([sweep(), sweep()]);
    expect(await readEvent(id)).toMatchObject({
      status: "planning",
      confirmedAt: null,
      confirmedById: null,
      confirmedByName: null,
    });
    const rows = (await notices(id)).filter(
      row => row.kind === "event_safety_reconfirmation_required"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientId).toBe(coordinator.id);
    expect((await reviews(id)).filter(row => row.state === "pending")).toHaveLength(1);
    const payload = parseNotificationPayload(rows[0].kind, rows[0].payload);
    if (!payload || payload.kind !== "event_safety_reconfirmation_required") {
      throw new Error("Notification payload did not parse");
    }
    expect(payload.payload.reason).toBe("out_of_date");
    const email = renderNotificationEmail({ ...payload, eventRequestId: id });
    expect(await render(email.element)).toContain("Safety approval needs renewal");
  });

  test("preserves legacy confirmed events and approvals that become current again", async () => {
    const legacy = await createEvent("confirmed");
    await createBooking(legacy);
    await sweep();
    expect((await readEvent(legacy)).status).toBe("confirmed");
    expect(await reviews(legacy)).toHaveLength(0);
    const id = await createEvent("confirmed");
    // No ledger is needed to read the fingerprint.
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: id,
      venueId,
      requestedById: coordinator.id,
      startsAt: "2042-01-01 09:00:00",
      endsAt: "2042-01-01 10:00:00",
      status: "approved",
    });
    await decideReview(id, "approved");
    await database
      .update(schema.eventRequests)
      .set({ roomLayoutPreference: "Banquet" })
      .where(eq(schema.eventRequests.id, id));
    await database
      .update(schema.eventRequests)
      .set({ roomLayoutPreference: "Theatre" })
      .where(eq(schema.eventRequests.id, id));
    await sweep();
    expect((await readEvent(id)).status).toBe("confirmed");
    expect(await notices(id)).toHaveLength(0);
  });

  test("rolls back the event and review when notification insertion fails", async () => {
    const id = await createEvent("confirmed");
    await createBooking(id);
    await createReview(id, "old");
    vi.spyOn(notificationWriter, "raiseNotifications").mockRejectedValueOnce(
      new Error("queue failed")
    );
    await expect(sweep()).rejects.toThrow("queue failed");
    expect((await readEvent(id)).status).toBe("confirmed");
    expect(await reviews(id)).toHaveLength(1);
    expect((await reviews(id))[0].fingerprint).toBe("old");
    expect(await notices(id)).toHaveLength(0);
  });

  test("falls back to every Lead when a confirmed event has no Coordinator", async () => {
    const id = await createEvent("confirmed", { coordinatorId: null });
    await createBooking(id);
    await createReview(id, "old");
    await sweep();
    const rows = (await notices(id)).filter(
      row => row.kind === "event_safety_reconfirmation_required"
    );
    const leads = await database
      .select()
      .from(schema.user)
      .where(eq(schema.user.role, "event_coordinator_lead"));
    expect(rows.map(row => row.recipientId).toSorted()).toEqual(
      leads.map(row => row.id).toSorted()
    );
  });
  test.each(["pending", "rejected", "changes_requested"] as const)(
    "reverts a confirmed event with a current %s review without replacing that review",
    async state => {
      const id = await createEvent("confirmed");
      await createBooking(id);
      if (state === "pending") await createReview(id);
      else await decideReview(id, state);
      await sweep();
      expect((await readEvent(id)).status).toBe("planning");
      expect(await reviews(id)).toHaveLength(1);
      const rows = (await notices(id)).filter(
        row => row.kind === "event_safety_reconfirmation_required"
      );
      expect(rows).toHaveLength(1);
      const payload = parseNotificationPayload(rows[0].kind, rows[0].payload);
      if (!payload || payload.kind !== "event_safety_reconfirmation_required") {
        throw new Error("Notification payload did not parse");
      }
      expect(payload.payload.reason).toBe(state);
    }
  );

  test("reverts a stale incomplete confirmed event without refreshing its pending review", async () => {
    const id = await createEvent("confirmed");
    await createBooking(id);
    const original = await createReview(id, "old");
    await createLine(id, "Projector", "requested");
    await sweep();
    expect((await readEvent(id)).status).toBe("planning");
    expect(await reviews(id)).toHaveLength(1);
    expect((await reviews(id))[0]).toMatchObject({
      id: original.id,
      fingerprint: "old",
      refreshedAt: null,
    });
    expect((await notices(id)).filter(row => row.kind === "safety_review_requested")).toHaveLength(
      0
    );
  });
});
