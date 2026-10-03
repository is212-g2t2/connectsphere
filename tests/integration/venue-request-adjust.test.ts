// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import { loadVenueRequestOutcomesForEvents } from "#/features/venue-requests/records.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleGetVenueRequestContext,
  handleRejectVenueRequest,
} from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-35 at the handler boundary: the rejection a Coordinator adjusts from stays on the record
 * beside the new pending request, and the adjusted request is an ordinary pending request that
 * moves nothing else on the event.
 */
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(to: string, subject: string, body: unknown) => Promise<unknown>>()
    .mockResolvedValue({ id: "test-email" }),
}));
vi.mock("#/lib/mailer.server", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail,
}));

const users = {
  organiser: {
    id: "adjust-organiser",
    name: "Adjust Organiser",
    email: "adjust-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "adjust-coordinator",
    name: "Adjust Coordinator",
    email: "adjust-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "adjust-venue-staff",
    name: "Adjust Venue Staff",
    email: "adjust-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
  attendee: {
    id: "adjust-attendee",
    name: "Adjust Attendee",
    email: "adjust-attendee@example.invalid",
    emailVerified: true,
    role: "attendee",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAMES = ["PTR-35 Refused Hall", "PTR-35 Suggested Room"];

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

describe("adjusting a request after a suggestion (PTR-35)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let refusedVenueId: number;
  let suggestedVenueId: number;
  let eventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(user => user.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    sendEmail.mockClear();
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));
    const [refused, suggested] = await database
      .insert(schema.venues)
      .values(
        VENUE_NAMES.map(name => ({
          name,
          location: "Adjust Wing",
          maxCapacity: 150,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    refusedVenueId = refused.id;
    suggestedVenueId = suggested.id;
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-35 Event",
        proposedDates: [{ start: "2027-05-10T09:00", end: "2027-05-10T12:00" }],
        equipmentRequirements: [],
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
    await database.insert(schema.equipmentRequests).values({
      id: `er-${crypto.randomUUID()}`,
      eventId,
      item: "Projector",
      quantity: 2,
    });
    // One registration on the event, so AC4's "unchanged" comparison has a row to compare.
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId, attendeeId: users.attendee.id })
      .onConflictDoNothing();
  });

  /** A request on the refused hall, rejected with a full suggestion of the other room. */
  async function rejectedWithSuggestion() {
    const request = await handleCreateVenueRequest(
      {
        eventId,
        venueId: refusedVenueId,
        date: "2027-05-10",
        startTime: "09:00",
        endTime: "12:00",
      },
      session(users.coordinator),
      database as never
    );
    await handleRejectVenueRequest(
      {
        id: request.id,
        reason: "Closed for floor resurfacing",
        suggestedVenueId,
        suggestedDate: "2027-05-11",
        suggestedStartTime: "10:00",
        suggestedEndTime: "13:30",
      },
      session(users.venueStaff),
      database as never
    );
    return request;
  }

  it("carries the venue ids an adjusted request opens with (AC1)", async () => {
    await rejectedWithSuggestion();

    const outcomes = await loadVenueRequestOutcomesForEvents(database, [eventId]);
    expect(outcomes.get(eventId)).toMatchObject({
      status: "rejected",
      rejection: {
        venueId: refusedVenueId,
        suggestedVenueId,
        suggestion: {
          venueName: VENUE_NAMES[1],
          date: "2027-05-11",
          startTime: "10:00",
          endTime: "13:30",
        },
      },
    });
  });

  it("queues the adjusted request as a new pending request on the suggested venue (AC2)", async () => {
    const rejected = await rejectedWithSuggestion();

    const adjusted = await handleCreateVenueRequest(
      {
        eventId,
        venueId: suggestedVenueId,
        date: "2027-05-11",
        startTime: "10:00",
        endTime: "13:30",
      },
      session(users.coordinator),
      database as never
    );

    expect(adjusted).toMatchObject({
      status: "pending",
      venueId: suggestedVenueId,
      startsAt: "2027-05-11 10:00:00",
      endsAt: "2027-05-11 13:30:00",
      requestedById: users.coordinator.id,
    });
    expect(adjusted.id).not.toBe(rejected.id);
    // The panel on the suggested venue now shows the pending request, withdrawable by its raiser.
    const context = await handleGetVenueRequestContext(
      { eventId, venueId: suggestedVenueId },
      session(users.coordinator),
      database as never
    );
    expect(context?.request).toMatchObject({ id: adjusted.id, canWithdraw: true });
  });

  it("keeps the original rejection and its reason beside the pending request (AC3)", async () => {
    await rejectedWithSuggestion();
    await handleCreateVenueRequest(
      {
        eventId,
        venueId: suggestedVenueId,
        date: "2027-05-11",
        startTime: "10:00",
        endTime: "13:30",
      },
      session(users.coordinator),
      database as never
    );

    const [card] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    expect(card.event.venueRequest).toMatchObject({
      status: "pending",
      rejection: {
        venueId: refusedVenueId,
        venueName: VENUE_NAMES[0],
        reason: "Closed for floor resurfacing",
        suggestedVenueId,
      },
    });
  });

  it("shows the Organiser and Venue Staff the pending request without the rejection", async () => {
    await rejectedWithSuggestion();
    await handleCreateVenueRequest(
      {
        eventId,
        venueId: suggestedVenueId,
        date: "2027-05-11",
        startTime: "10:00",
        endTime: "13:30",
      },
      session(users.coordinator),
      database as never
    );

    const [organiserCard] = await handleListEvents(
      { eventId },
      session(users.organiser),
      database as never
    );
    expect(organiserCard.event.venueRequest).toEqual({ status: "pending" });
    const [staffCard] = await handleListEvents(
      { eventId },
      session(users.venueStaff),
      database as never
    );
    expect(staffCard.event.venueRequest).toEqual({ status: "pending" });
  });

  it("surfaces no rejection once a later request is approved", async () => {
    await rejectedWithSuggestion();
    const adjusted = await handleCreateVenueRequest(
      {
        eventId,
        venueId: suggestedVenueId,
        date: "2027-05-11",
        startTime: "10:00",
        endTime: "13:30",
      },
      session(users.coordinator),
      database as never
    );
    await handleApproveVenueRequest(
      { id: adjusted.id },
      session(users.venueStaff),
      database as never
    );

    const outcomes = await loadVenueRequestOutcomesForEvents(database, [eventId]);
    expect(outcomes.get(eventId)).toBeUndefined();
  });

  it("changes nothing else on the event: status, equipment and registrations (AC4)", async () => {
    await rejectedWithSuggestion();
    const before = {
      event: (
        await database
          .select({
            status: schema.eventRequests.status,
            equipmentSubmittedAt: schema.eventRequests.equipmentSubmittedAt,
          })
          .from(schema.eventRequests)
          .where(eq(schema.eventRequests.id, eventId))
      )[0],
      equipment: await database
        .select()
        .from(schema.equipmentRequests)
        .where(eq(schema.equipmentRequests.eventId, eventId)),
      registrations: await database
        .select()
        .from(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.eventId, eventId)),
    };

    await handleCreateVenueRequest(
      {
        eventId,
        venueId: suggestedVenueId,
        date: "2027-05-11",
        startTime: "10:00",
        endTime: "13:30",
      },
      session(users.coordinator),
      database as never
    );

    const after = {
      event: (
        await database
          .select({
            status: schema.eventRequests.status,
            equipmentSubmittedAt: schema.eventRequests.equipmentSubmittedAt,
          })
          .from(schema.eventRequests)
          .where(eq(schema.eventRequests.id, eventId))
      )[0],
      equipment: await database
        .select()
        .from(schema.equipmentRequests)
        .where(eq(schema.equipmentRequests.eventId, eventId)),
      registrations: await database
        .select()
        .from(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.eventId, eventId)),
    };
    expect(after).toEqual(before);
    expect(before.event.status).toBe("submitted");
    // Two rows now sit on the event: the rejected one and the pending one; the rejected is intact.
    const rows = await database
      .select({ status: schema.venueRequests.status, venueId: schema.venueRequests.venueId })
      .from(schema.venueRequests)
      .where(and(eq(schema.venueRequests.eventId, eventId)));
    expect(rows.map(row => row.status).toSorted()).toEqual(["pending", "rejected"]);
  });
});
