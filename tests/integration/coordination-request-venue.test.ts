// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleGetCoordinationRequest } from "#/features/coordination/assignments.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

const users = {
  organiser: {
    id: "triage-venue-organiser",
    name: "Triage Organiser",
    email: "triage-venue-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "triage-venue-coordinator",
    name: "Triage Coordinator",
    email: "triage-venue-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAMES = ["Triage Refused Hall", "Triage Suggested Room"];

function session(): SessionUser {
  const coordinator = users.coordinator;
  return {
    id: coordinator.id,
    email: coordinator.email,
    name: coordinator.name,
    role: coordinator.role,
  };
}

describe("coordination request venue summary", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let refusedVenueId: number;
  let suggestedVenueId: number;
  let eventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
    const [refused, suggested] = await database
      .insert(schema.venues)
      .values(
        VENUE_NAMES.map(name => ({
          name,
          location: "Triage Wing",
          maxCapacity: 150,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    refusedVenueId = refused.id;
    suggestedVenueId = suggested.id;
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
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: null,
        eventName: "Triage Venue Event",
        proposedDates: [{ start: "2027-05-10T09:00", end: "2027-05-10T12:00" }],
        equipmentRequirements: [],
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
  });

  it("carries the rejected booking with its reason, suggestion and suggested venue", async () => {
    await database.insert(schema.venueRequests).values({
      id: "triage-vr-rejected",
      eventId,
      venueId: refusedVenueId,
      startsAt: "2027-05-10 09:00:00",
      endsAt: "2027-05-10 12:00:00",
      requestedById: users.coordinator.id,
      status: "rejected",
      rejectionReason: "The main hall is being rewired that weekend.",
      suggestedVenueId,
      suggestedDate: "2027-05-11",
      suggestedStartTime: "09:00:00",
      suggestedEndTime: "12:00:00",
    });

    const request = await handleGetCoordinationRequest(
      { id: eventId },
      session(),
      database as never
    );

    expect(request.venueRequests).toMatchObject([
      {
        id: "triage-vr-rejected",
        status: "rejected",
        venueName: "Triage Refused Hall",
        date: "2027-05-10",
        startTime: "09:00",
        endTime: "12:00",
        adjustable: true,
        rejection: {
          reason: "The main hall is being rewired that weekend.",
          suggestedVenueId,
          suggestion: {
            venueName: "Triage Suggested Room",
            date: "2027-05-11",
            startTime: "09:00",
            endTime: "12:00",
          },
        },
      },
    ]);
  });

  it("carries a pending request without a rejection", async () => {
    await database.insert(schema.venueRequests).values({
      id: "triage-vr-pending",
      eventId,
      venueId: refusedVenueId,
      startsAt: "2027-05-10 09:00:00",
      endsAt: "2027-05-10 12:00:00",
      requestedById: users.coordinator.id,
      status: "pending",
    });

    const request = await handleGetCoordinationRequest(
      { id: eventId },
      session(),
      database as never
    );

    expect(request.venueRequests).toMatchObject([
      {
        id: "triage-vr-pending",
        status: "pending",
        venueName: "Triage Refused Hall",
      },
    ]);
    expect(request.venueRequests).toHaveLength(1);
    expect(request.venueRequests[0]).not.toHaveProperty("rejection");
  });

  it("keeps a rejection adjustable beside a newer request at another venue", async () => {
    await database.insert(schema.venueRequests).values([
      {
        id: "triage-vr-hall-a-rejected",
        eventId,
        venueId: refusedVenueId,
        startsAt: "2027-05-10 09:00:00",
        endsAt: "2027-05-10 12:00:00",
        requestedById: users.coordinator.id,
        status: "rejected",
        rejectionReason: "The main hall is being rewired that weekend.",
        createdAt: new Date("2027-04-01T00:00:00Z"),
        updatedAt: new Date("2027-04-02T00:00:00Z"),
      },
      {
        id: "triage-vr-annex-approved",
        eventId,
        venueId: suggestedVenueId,
        startsAt: "2027-05-10 13:00:00",
        endsAt: "2027-05-10 15:00:00",
        requestedById: users.coordinator.id,
        status: "approved",
        createdAt: new Date("2027-04-03T00:00:00Z"),
        updatedAt: new Date("2027-04-04T00:00:00Z"),
      },
    ]);

    const request = await handleGetCoordinationRequest(
      { id: eventId },
      session(),
      database as never
    );

    // The adjust link opens the rejected venue. The newer request is at another venue.
    expect(request.venueRequests).toMatchObject([
      { id: "triage-vr-hall-a-rejected", status: "rejected", adjustable: true },
      { id: "triage-vr-annex-approved", status: "approved" },
    ]);
    expect(request.venueRequests[1]).not.toHaveProperty("adjustable");
  });

  it("stops a rejection being adjustable once a newer request opens at its target venue", async () => {
    await database.insert(schema.venueRequests).values([
      {
        id: "triage-vr-suggested-rejected",
        eventId,
        venueId: refusedVenueId,
        startsAt: "2027-05-10 09:00:00",
        endsAt: "2027-05-10 12:00:00",
        requestedById: users.coordinator.id,
        status: "rejected",
        rejectionReason: "The main hall is being rewired that weekend.",
        suggestedVenueId,
        createdAt: new Date("2027-04-01T00:00:00Z"),
        updatedAt: new Date("2027-04-02T00:00:00Z"),
      },
      {
        // A request at the rejected venue does not answer a suggestion for another venue.
        id: "triage-vr-refused-again",
        eventId,
        venueId: refusedVenueId,
        startsAt: "2027-05-10 13:00:00",
        endsAt: "2027-05-10 15:00:00",
        requestedById: users.coordinator.id,
        status: "pending",
        createdAt: new Date("2027-04-03T00:00:00Z"),
      },
    ]);

    const before = await handleGetCoordinationRequest(
      { id: eventId },
      session(),
      database as never
    );
    expect(before.venueRequests[0]).toMatchObject({
      id: "triage-vr-suggested-rejected",
      adjustable: true,
    });

    await database.insert(schema.venueRequests).values({
      id: "triage-vr-suggested-pending",
      eventId,
      venueId: suggestedVenueId,
      startsAt: "2027-05-11 09:00:00",
      endsAt: "2027-05-11 12:00:00",
      requestedById: users.coordinator.id,
      status: "pending",
      createdAt: new Date("2027-04-03T00:00:00Z"),
    });

    const after = await handleGetCoordinationRequest({ id: eventId }, session(), database as never);
    expect(after.venueRequests.map(entry => entry.id)).toContain("triage-vr-suggested-rejected");
    for (const entry of after.venueRequests) expect(entry).not.toHaveProperty("adjustable");
  });

  it("lists no entries when the event has no venue request", async () => {
    const request = await handleGetCoordinationRequest(
      { id: eventId },
      session(),
      database as never
    );

    expect(request.venueRequests).toEqual([]);
  });
});
