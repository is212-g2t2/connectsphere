// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleGetVenueRequestContext,
  handleRejectVenueRequest,
} from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/** PTR-35: keep the original rejection on the record beside the new pending request. The adjusted
 * request is an ordinary pending request and changes no other event data.
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
    // Add one registration so AC4 can check that the event data stays unchanged.
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId, attendeeId: users.attendee.id })
      .onConflictDoNothing();
  });

  /** The adjusted request for the suggested venue. */
  async function adjustRequest() {
    return handleCreateVenueRequest(
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
  }

  /** Event state for AC4: status, equipment lines, and registrations. */
  async function eventSnapshot() {
    return {
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
  }

  /** A rejected request for one hall, with a full suggestion for another room. */
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
    const rejected = await rejectedWithSuggestion();

    const [card] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    expect(card.event.venueRequests).toEqual([
      {
        id: rejected.id,
        status: "rejected",
        venueName: VENUE_NAMES[0],
        date: "2027-05-10",
        startTime: "09:00",
        endTime: "12:00",
        adjustable: true,
        rejection: {
          venueId: refusedVenueId,
          venueName: VENUE_NAMES[0],
          date: "2027-05-10",
          startTime: "09:00",
          endTime: "12:00",
          reason: "Closed for floor resurfacing",
          suggestedVenueId,
          suggestion: {
            venueName: VENUE_NAMES[1],
            date: "2027-05-11",
            startTime: "10:00",
            endTime: "13:30",
          },
        },
      },
    ]);
  });

  it("queues the adjusted request as a new pending request on the suggested venue (AC2)", async () => {
    const rejected = await rejectedWithSuggestion();

    const adjusted = await adjustRequest();

    expect(adjusted).toMatchObject({
      status: "pending",
      venueId: suggestedVenueId,
      startsAt: "2027-05-11 10:00:00",
      endsAt: "2027-05-11 13:30:00",
      requestedById: users.coordinator.id,
    });
    expect(adjusted.id).not.toBe(rejected.id);
    // The suggested venue's panel lists the pending request, which its raiser can withdraw.
    const context = await handleGetVenueRequestContext(
      { eventId, venueId: suggestedVenueId },
      session(users.coordinator),
      database as never
    );
    expect(context?.requests).toEqual([
      expect.objectContaining({ id: adjusted.id, status: "pending", canWithdraw: true }),
    ]);
  });

  it("keeps the original rejection and its reason beside the pending request (AC3)", async () => {
    const rejected = await rejectedWithSuggestion();
    const adjusted = await adjustRequest();

    const [card] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    // Each row keeps its own state: the rejection stays on its row beside the pending request.
    expect(card.event.venueRequests).toMatchObject([
      {
        id: rejected.id,
        status: "rejected",
        venueName: VENUE_NAMES[0],
        rejection: {
          venueId: refusedVenueId,
          venueName: VENUE_NAMES[0],
          reason: "Closed for floor resurfacing",
          suggestedVenueId,
        },
      },
      {
        id: adjusted.id,
        status: "pending",
        venueName: VENUE_NAMES[1],
      },
    ]);
    expect(card.event.venueRequests?.[1]).not.toHaveProperty("rejection");
    // The adjusted request answers the rejection at the venue the link opens, so the link goes.
    expect(card.event.venueRequests?.[0]).not.toHaveProperty("adjustable");
  });

  it("keeps a rejection adjustable when the next request names another venue", async () => {
    // Hall A refuses with no suggestion, so the adjust link reopens Hall A.
    const refused = await handleCreateVenueRequest(
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
      { id: refused.id, reason: "Closed for floor resurfacing" },
      session(users.venueStaff),
      database as never
    );
    // A later request for the annex is approved. It does not answer the Hall A rejection.
    const annex = await adjustRequest();
    await handleApproveVenueRequest({ id: annex.id }, session(users.venueStaff), database as never);

    const [card] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    expect(card.event.venueRequests).toMatchObject([
      { id: refused.id, status: "rejected", adjustable: true },
      { id: annex.id, status: "approved" },
    ]);
    expect(card.event.venueRequests?.[1]).not.toHaveProperty("adjustable");

    // A newer request at Hall A answers the rejection.
    await handleCreateVenueRequest(
      {
        eventId,
        venueId: refusedVenueId,
        date: "2027-05-12",
        startTime: "09:00",
        endTime: "12:00",
      },
      session(users.coordinator),
      database as never
    );
    const [answered] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    expect(answered.event.venueRequests?.find(entry => entry.id === refused.id)).not.toHaveProperty(
      "adjustable"
    );
  });

  it("changes nothing else on the event: status, equipment and registrations (AC4)", async () => {
    await rejectedWithSuggestion();
    const before = await eventSnapshot();

    await adjustRequest();

    const after = await eventSnapshot();
    expect(after).toEqual(before);
    expect(before.event.status).toBe("submitted");
    // The event has two rows: one rejected and one pending. The rejected row is unchanged.
    const rows = await database
      .select({ status: schema.venueRequests.status, venueId: schema.venueRequests.venueId })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, eventId));
    expect(rows.map(row => row.status).toSorted()).toEqual(["pending", "rejected"]);
  });
});
