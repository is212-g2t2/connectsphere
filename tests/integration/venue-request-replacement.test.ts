// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  VENUE_REQUEST_ALREADY_REPLACED_MESSAGE,
  VENUE_REQUEST_NOT_REPLACEABLE_MESSAGE,
  VENUE_REQUEST_NOT_SETTLED_MESSAGE,
} from "#/features/venue-requests/schema";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleDismissVenueRequest,
  handleGetVenueRequestContext,
  handleRejectVenueRequest,
  handleWithdrawVenueRequest,
} from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-165: a settled request, or an approved booking about to be released, is answered only by the
 * request that names it. This file tests the replacement chain, the one-live-replacement index, the
 * Coordinator's dismissal, and the venue page's list of replaceable requests.
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
    id: "replacement-organiser",
    name: "Replacement Organiser",
    email: "replacement-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "replacement-coordinator",
    name: "Replacement Coordinator",
    email: "replacement-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "replacement-other-coordinator",
    name: "Replacement Other Coordinator",
    email: "replacement-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "replacement-venue-staff",
    name: "Replacement Venue Staff",
    email: "replacement-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAMES = ["PTR-165 Hall", "PTR-165 Suggested Room", "PTR-165 Replacement Annex"];

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

describe("replacing a settled venue request (PTR-165)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueIds: number[];
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
    venueIds = (
      await database
        .insert(schema.venues)
        .values(
          VENUE_NAMES.map(name => ({
            name,
            location: "PTR-165 Wing",
            maxCapacity: 150,
            operatingHours: DEFAULT_OPERATING_HOURS,
          }))
        )
        .returning({ id: schema.venues.id })
    ).map(venue => venue.id);
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-165 Event",
        proposedDates: [{ start: "2027-06-10T09:00", end: "2027-06-10T12:00" }],
        equipmentRequirements: [],
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
  });

  /** Raise one request at the given venue and window. */
  function raise(venueId: number, startTime: string, endTime: string, replacesRequestId?: string) {
    return handleCreateVenueRequest(
      {
        eventId,
        venueId,
        date: "2027-06-10",
        startTime,
        endTime,
        ...(replacesRequestId === undefined ? {} : { replacesRequestId }),
      },
      session(users.coordinator),
      database as never
    );
  }

  /** Raise and reject a request, so a replacement can name it. */
  async function reject(
    venueId: number,
    startTime: string,
    endTime: string,
    suggestedVenueId?: number
  ) {
    const request = await raise(venueId, startTime, endTime);
    await handleRejectVenueRequest(
      {
        id: request.id,
        reason: "Closed for floor resurfacing",
        ...(suggestedVenueId === undefined ? {} : { suggestedVenueId }),
      },
      session(users.venueStaff),
      database as never
    );
    return request;
  }

  const context = (actor: (typeof users)[keyof typeof users]) =>
    handleGetVenueRequestContext(
      { eventId, venueId: venueIds[0] },
      session(actor),
      database as never
    );

  it("stores the request that a new request replaces (AC1)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00");

    const replacement = await raise(venueIds[1], "11:00", "12:00", rejected.id);

    expect(replacement).toMatchObject({
      status: "pending",
      replacesRequestId: rejected.id,
      venueId: venueIds[1],
    });
  });

  it("answers the rejection through its replacement, at any venue (AC2)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00", venueIds[1]);

    await raise(venueIds[1], "11:00", "12:00", rejected.id);

    const view = await context(users.coordinator);
    expect(view?.requests.find(row => row.id === rejected.id)).toMatchObject({
      status: "rejected",
      answered: true,
    });
  });

  it("refuses a missing, foreign, pending, or already replaced target (AC1, AC6)", async () => {
    const pending = await raise(venueIds[0], "09:00", "10:00");
    const [foreign] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-165 Foreign Event",
        proposedDates: [],
        equipmentRequirements: [],
      })
      .returning({ id: schema.eventRequests.id });
    const [foreignRow] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: foreign.id,
        venueId: venueIds[0],
        requestedById: users.coordinator.id,
        startsAt: "2027-06-10 09:00:00",
        endsAt: "2027-06-10 10:00:00",
        status: "rejected",
        rejectionReason: "Fully booked",
      })
      .returning({ id: schema.venueRequests.id });

    await expect(raise(venueIds[1], "11:00", "12:00", "missing")).rejects.toMatchObject({
      status: 404,
    });
    await expect(raise(venueIds[1], "11:00", "12:00", foreignRow.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(raise(venueIds[1], "11:00", "12:00", pending.id)).rejects.toMatchObject({
      status: 409,
      message: VENUE_REQUEST_NOT_REPLACEABLE_MESSAGE,
    });

    const rejected = await reject(venueIds[0], "13:00", "14:00");
    await raise(venueIds[1], "11:00", "12:00", rejected.id);
    await expect(raise(venueIds[2], "15:00", "16:00", rejected.id)).rejects.toMatchObject({
      status: 409,
      message: VENUE_REQUEST_ALREADY_REPLACED_MESSAGE,
    });
  });

  it("keeps one live replacement per request, and a withdrawn one frees it (AC6)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00");
    const replacement = await raise(venueIds[1], "11:00", "12:00", rejected.id);

    // A writer outside the handler cannot give one request a second live replacement.
    await expect(
      database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId,
        venueId: venueIds[2],
        requestedById: users.coordinator.id,
        startsAt: "2027-06-10 13:00:00",
        endsAt: "2027-06-10 14:00:00",
        status: "pending",
        replacesRequestId: rejected.id,
      })
    ).rejects.toMatchObject({ cause: { constraint: "venue_requests_replaces_request_id_idx" } });

    // A withdrawn replacement frees the settled row for a new one.
    await handleWithdrawVenueRequest(
      { id: replacement.id },
      session(users.coordinator),
      database as never
    );
    const second = await raise(venueIds[2], "13:00", "14:00", rejected.id);
    expect(second.replacesRequestId).toBe(rejected.id);
  });

  it("offers the event's rejected, released, and approved requests, and not the replaced ones (AC1)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00");
    const releaseCandidate = await raise(venueIds[0], "11:00", "12:00");
    await handleApproveVenueRequest(
      { id: releaseCandidate.id },
      session(users.venueStaff),
      database as never
    );
    const pending = await raise(venueIds[0], "13:00", "14:00");

    const offered = (await context(users.coordinator))?.replaceable ?? [];
    expect(offered.map(row => [row.id, row.status])).toEqual([
      [rejected.id, "rejected"],
      [releaseCandidate.id, "approved"],
    ]);

    await raise(venueIds[1], "15:00", "16:00", rejected.id);

    expect((await context(users.coordinator))?.replaceable.map(row => row.id)).toEqual([
      releaseCandidate.id,
    ]);
    expect(pending.id).not.toBe(rejected.id);
  });

  it("dismisses a settled request for the assigned Coordinator alone (AC4)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00");
    const pending = await raise(venueIds[0], "11:00", "12:00");

    await expect(
      handleDismissVenueRequest(
        { id: rejected.id },
        session(users.otherCoordinator),
        database as never
      )
    ).rejects.toMatchObject({ status: 403 });
    // A missing row and a pending row refuse in the same way as another Coordinator's row.
    await expect(
      handleDismissVenueRequest({ id: "missing" }, session(users.coordinator), database as never)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleDismissVenueRequest({ id: pending.id }, session(users.coordinator), database as never)
    ).rejects.toMatchObject({ status: 409, message: VENUE_REQUEST_NOT_SETTLED_MESSAGE });

    const dismissed = await handleDismissVenueRequest(
      { id: rejected.id },
      session(users.coordinator),
      database as never
    );
    expect(dismissed).toMatchObject({
      status: "rejected",
      dismissedById: users.coordinator.id,
    });
    expect(dismissed.dismissedAt).toBeInstanceOf(Date);

    // The settled row stops blocking confirmation, and the panel says so.
    const view = await context(users.coordinator);
    expect(view?.requests.find(row => row.id === rejected.id)).toMatchObject({
      answered: true,
      dismissed: true,
    });
    // A dismissed row needs no replacement, so it leaves the picker.
    expect((await context(users.coordinator))?.replaceable.map(row => row.id)).toEqual([]);
  });

  it("withdraws a dismissed settled row (PTR-165 AC4)", async () => {
    const rejected = await reject(venueIds[0], "09:00", "10:00");
    await handleDismissVenueRequest(
      { id: rejected.id },
      session(users.coordinator),
      database as never
    );

    const withdrawn = await handleWithdrawVenueRequest(
      { id: rejected.id },
      session(users.coordinator),
      database as never
    );

    expect(withdrawn).toMatchObject({ status: "withdrawn" });
    // The dismissal stays as history; the CHECK allows the later withdrawal.
    expect(withdrawn.dismissedAt).toBeInstanceOf(Date);
  });
});
