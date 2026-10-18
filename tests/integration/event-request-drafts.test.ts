// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleAcceptEventHandover,
  handleDecideEventRequest,
  handleDeclineEventHandover,
  handleGetCoordinationRequest,
  handleListAssignedEventRequests,
  handleListPendingEventHandovers,
  handleRaiseClarificationRequest,
  handleRequestEventHandover,
  handleTakeUpForReview,
} from "#/features/coordination/assignments.server";
import { handleRaiseEventChangeRequest } from "#/features/event-requests/change-requests.server";
import { handleRequestEventCancellation } from "#/features/event-requests/cancellation-requests.server";
import {
  handleGetEventRequest,
  handleListEventRequests,
  handleListUnassignedEventRequests,
  handleDeleteEventRequestDraft,
  handleGetEventRequestDraft,
  handleSaveEventRequestDraft,
  handleSubmitEventRequest,
} from "#/features/event-requests/drafts.server";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import { handleLiftVenueBlock, handleRecordVenueBlock } from "#/features/venues/blocks.server";
import { handleSaveVenue } from "#/features/venues/records.server";
import { notificationSummary } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import {
  ALREADY_SUBMITTED_MESSAGE,
  ATTENDANCE_MESSAGE,
  END_BEFORE_START_MESSAGE,
  EQUIPMENT_QUANTITY_MESSAGE,
  EVENT_REQUEST_DELETE_REFUSAL,
  REGISTRATION_CAPACITY_MESSAGE,
  REGISTRATION_CAPACITY_REQUIRED_MESSAGE,
  REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE,
  REGISTRATION_CLOSES_REQUIRED_MESSAGE,
  REGISTRATION_OPENS_REQUIRED_MESSAGE,
  SUBMITTED_EDIT_REFUSAL,
  missingFieldsMessage,
} from "#/features/event-requests/schema";

const organiser: SessionUser = {
  id: "test-organiser-drafts",
  email: "drafts.organiser@example.com",
  role: "event_organiser",
};
const otherOrganiser: SessionUser = {
  id: "test-organiser-other",
  email: "other.organiser@example.com",
  role: "event_organiser",
};
/** The seeded Venue Staff account, which records and lifts the AC3 venue block. */
const seedVenueStaff: SessionUser = {
  id: "seed-venue-staff-1",
  email: "venue.staff.seed@example.com",
  role: "venue_staff",
};

/**
 * This file owns its organiser fixtures. Hooks delete by these ids. The seeded demo event
 * belongs to `test-user-2`, so deletes never touch it. Deleting the fixture users removes this
 * file's event requests.
 */
const organiserFixtures = [
  {
    id: organiser.id,
    name: "Drafts Organiser",
    email: organiser.email,
    emailVerified: true,
    role: "event_organiser",
  },
  {
    id: otherOrganiser.id,
    name: "Other Organiser",
    email: otherOrganiser.email,
    emailVerified: true,
    role: "event_organiser",
  },
];

const organiserIds = organiserFixtures.map(user => user.id);

async function ownedRequestCount(database: ReturnType<typeof drizzle<typeof schema>>) {
  const rows = await database
    .select()
    .from(schema.eventRequests)
    .where(inArray(schema.eventRequests.organiserId, organiserIds));
  return rows.length;
}

let fixturePool: Pool;
beforeAll(async () => {
  fixturePool = new Pool({ connectionString: process.env.DATABASE_URL });
  await drizzle(fixturePool, { schema })
    .insert(schema.user)
    .values(organiserFixtures)
    .onConflictDoNothing();
});
afterAll(async () => {
  await drizzle(fixturePool, { schema })
    .delete(schema.user)
    .where(inArray(schema.user.id, organiserIds));
  await fixturePool.end();
});

const fullRequest: EventRequestDraftValues = {
  eventName: "  Community workshop  ",
  purpose: "Meet neighbours\n  Plan next steps  ",
  proposedDates: [
    { start: "2026-10-12T14:30", end: "2026-10-12T18:45" },
    { start: "2026-10-10T09:00", end: "2026-10-11T00:15" },
  ],
  expectedAttendance: 25,
  description: "  First line\nSecond line  ",
  eventType: " Workshop / Q&A ",
  venueRequirements: "  Near MRT\nGround floor ",
  roomLayoutPreference: " U-shape  ",
  accessibilityRequirements: "  Step-free access ",
  equipmentRequirements: [
    { type: "  Wireless microphone ", quantity: 2 },
    { type: "Projector", quantity: 1 },
  ],
  specialArrangements: "  Quiet room\nDietary options  ",
  registrationEnabled: false,
};

const enabledRegistration = {
  registrationEnabled: true,
  registrationCapacity: 25,
  registrationOpensAt: "2026-09-20T09:00",
  registrationClosesAt: "2026-09-30T18:00",
};

describe("Event request drafts", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  async function findById(id: number) {
    const rows = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, id));
    return rows.at(0) ?? null;
  }

  it("stores an empty request as a draft owned by its organiser", async () => {
    const saved = await handleSaveEventRequestDraft({}, organiser, database as never);

    expect(saved).toMatchObject({
      organiserId: organiser.id,
      status: "draft",
      eventName: "",
      purpose: "",
      proposedDates: [],
      expectedAttendance: null,
      description: "",
      eventType: "",
      venueRequirements: "",
      roomLayoutPreference: "",
      accessibilityRequirements: "",
      equipmentRequirements: [],
      specialArrangements: "",
    });
    expect(await findById(saved.id)).toEqual(saved);
  });

  it("reopens every captured value exactly as it was entered, repeated lines included", async () => {
    const saved = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const reopened = await findById(saved.id);

    expect(reopened).toEqual(saved);
    expect(reopened).toMatchObject({
      ...fullRequest,
      organiserId: organiser.id,
      status: "draft",
    });
  });

  it("saves a request with only some fields completed, half-typed lines included", async () => {
    const saved = await handleSaveEventRequestDraft(
      {
        eventName: "Community workshop",
        proposedDates: [{ start: "2026-11-18T09:30" }],
        equipmentRequirements: [{ type: "Projector" }],
      },
      organiser,
      database as never
    );

    expect(saved).toMatchObject({
      status: "draft",
      eventName: "Community workshop",
      purpose: "",
      // JSONB storage keeps the `datetime-local` spelling.
      proposedDates: [{ start: "2026-11-18T09:30" }],
      expectedAttendance: null,
      equipmentRequirements: [{ type: "Projector" }],
    });
  });

  it("replaces the full row on update rather than merging fields", async () => {
    const created = await handleSaveEventRequestDraft(
      {
        eventName: "Community workshop",
        purpose: "Meet neighbours",
        proposedDates: [{ start: "2026-11-18T09:30", end: "2026-11-18T12:00" }],
        expectedAttendance: 25,
        equipmentRequirements: [{ type: "Projector", quantity: 1 }],
      },
      organiser,
      database as never
    );

    // A partial payload with an existing id runs a PUT. Omitted fields go blank. The form
    // always resends the full draft.
    const updated = await handleSaveEventRequestDraft(
      { id: created.id },
      organiser,
      database as never
    );

    expect(updated).toMatchObject({
      id: created.id,
      eventName: "",
      purpose: "",
      proposedDates: [],
      expectedAttendance: null,
      equipmentRequirements: [],
      description: "",
      specialArrangements: "",
    });
  });

  it("refuses a malformed or invalid field before writing", async () => {
    await expect(
      handleSaveEventRequestDraft(
        {
          proposedDates: [{ start: "2026-11-18T09:30", end: "2026-11-18T09:00" }],
          expectedAttendance: 25,
        },
        organiser,
        database as never
      )
    ).rejects.toThrow(END_BEFORE_START_MESSAGE);

    await expect(
      handleSaveEventRequestDraft({ expectedAttendance: -1 }, organiser, database as never)
    ).rejects.toThrow(ATTENDANCE_MESSAGE);

    await expect(
      handleSaveEventRequestDraft(
        { equipmentRequirements: [{ type: "Projector", quantity: 0 }] },
        organiser,
        database as never
      )
    ).rejects.toThrow(EQUIPMENT_QUANTITY_MESSAGE);

    expect(await ownedRequestCount(database)).toBe(0);
  });

  it("edits the same draft when its id comes back, rather than opening another", async () => {
    const created = await handleSaveEventRequestDraft(
      { eventName: "Community workshop" },
      organiser,
      database as never
    );

    const updated = await handleSaveEventRequestDraft(
      {
        id: created.id,
        eventName: "Community workshop",
        purpose: "Meet neighbours",
      },
      organiser,
      database as never
    );

    expect(updated).toMatchObject({
      id: created.id,
      purpose: "Meet neighbours",
    });
    expect(await ownedRequestCount(database)).toBe(1);
  });

  it("refuses to edit a draft belonging to another organiser", async () => {
    const created = await handleSaveEventRequestDraft(
      { eventName: "Private draft" },
      organiser,
      database as never
    );

    await expect(
      handleSaveEventRequestDraft(
        { id: created.id, eventName: "Hijacked" },
        otherOrganiser,
        database as never
      )
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    expect(await findById(created.id)).toMatchObject({
      eventName: "Private draft",
    });
  });

  it("refuses an id that matches no draft instead of creating one", async () => {
    await expect(
      handleSaveEventRequestDraft({ id: 987654, eventName: "Ghost" }, organiser, database as never)
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    expect(await ownedRequestCount(database)).toBe(0);
  });

  it("stores the registration terms exactly and reopens them (PTR-11 AC1)", async () => {
    const saved = await handleSaveEventRequestDraft(
      enabledRegistration,
      organiser,
      database as never
    );
    const reopened = await findById(saved.id);

    expect(saved).toMatchObject(enabledRegistration);
    expect(reopened).toEqual(saved);
  });

  it.each([
    [
      { ...enabledRegistration, registrationCapacity: undefined },
      REGISTRATION_CAPACITY_REQUIRED_MESSAGE,
    ],
    [
      { ...enabledRegistration, registrationOpensAt: undefined },
      REGISTRATION_OPENS_REQUIRED_MESSAGE,
    ],
    [
      { ...enabledRegistration, registrationClosesAt: undefined },
      REGISTRATION_CLOSES_REQUIRED_MESSAGE,
    ],
  ])("refuses an enabled registration missing a term, naming it (AC2)", async (data, message) => {
    await expect(handleSaveEventRequestDraft(data, organiser, database as never)).rejects.toThrow(
      message
    );

    expect(await ownedRequestCount(database)).toBe(0);
  });

  it("refuses a registration window that does not close after it opens (AC3)", async () => {
    await expect(
      handleSaveEventRequestDraft(
        {
          ...enabledRegistration,
          registrationClosesAt: enabledRegistration.registrationOpensAt,
        },
        organiser,
        database as never
      )
    ).rejects.toThrow(REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE);
  });

  it("refuses a registration capacity that is not a positive whole number (AC4)", async () => {
    await expect(
      handleSaveEventRequestDraft(
        { ...enabledRegistration, registrationCapacity: 0 },
        organiser,
        database as never
      )
    ).rejects.toThrow(REGISTRATION_CAPACITY_MESSAGE);
  });

  it("stores no terms when registration is disabled, even if they are supplied (AC5)", async () => {
    const saved = await handleSaveEventRequestDraft(
      { ...enabledRegistration, registrationEnabled: false },
      organiser,
      database as never
    );

    expect(saved).toMatchObject({
      registrationEnabled: false,
      registrationCapacity: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
  });

  it("clears stored terms when a later save turns registration off (AC5)", async () => {
    const created = await handleSaveEventRequestDraft(
      enabledRegistration,
      organiser,
      database as never
    );

    const updated = await handleSaveEventRequestDraft(
      { id: created.id, registrationEnabled: false },
      organiser,
      database as never
    );

    expect(updated).toMatchObject({
      id: created.id,
      registrationEnabled: false,
      registrationCapacity: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
  });

  /** Check the persistence invariant with its three CHECK constraints. */
  it("refuses registration rows the CHECK constraints forbid (PTR-11)", async () => {
    // Drizzle wraps the driver error. Read the constraint name from the cause.
    await expect(
      database
        .insert(schema.eventRequests)
        .values({ organiserId: organiser.id, registrationEnabled: true })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_terms_match_enabled" },
    });

    await expect(
      database.insert(schema.eventRequests).values({
        ...enabledRegistration,
        organiserId: organiser.id,
        registrationEnabled: false,
      })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_terms_match_enabled" },
    });

    await expect(
      database.insert(schema.eventRequests).values({
        ...enabledRegistration,
        organiserId: organiser.id,
        registrationCapacity: 0,
      })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_capacity_positive" },
    });

    await expect(
      database.insert(schema.eventRequests).values({
        ...enabledRegistration,
        organiserId: organiser.id,
        registrationClosesAt: enabledRegistration.registrationOpensAt,
      })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_closes_after_opens" },
    });
  });

  // No read or list endpoint exists in this ticket. This test checks row ownership in the
  // database. It checks no visibility enforcement.
  it("scopes each draft's row to the organiser that created it", async () => {
    await handleSaveEventRequestDraft({ eventName: "Private draft" }, organiser, database as never);

    const ownRows = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, organiser.id));
    const otherRows = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, otherOrganiser.id));

    expect(ownRows).toHaveLength(1);
    expect(otherRows).toHaveLength(0);
  });

  /** PTR-13 submits the stored row that `fullRequest` describes, with every mandatory field
   * present. Each refusal below sends a draft that misses exactly one field.
   */
  it("refuses an incomplete draft, naming every missing mandatory field (AC1)", async () => {
    const draft = await handleSaveEventRequestDraft(
      { eventName: "Community workshop" },
      organiser,
      database as never
    );

    await expect(
      handleSubmitEventRequest({ id: draft.id }, organiser, database as never)
    ).rejects.toThrow(
      missingFieldsMessage(["Purpose", "Proposed dates and times", "Expected attendance"])
    );

    expect(await findById(draft.id)).toMatchObject({
      status: "draft",
      submittedAt: null,
    });
  });

  it("refuses a half-filled equipment line at submission, naming it (AC1)", async () => {
    const draft = await handleSaveEventRequestDraft(
      { ...fullRequest, equipmentRequirements: [{ type: "Projector" }] },
      organiser,
      database as never
    );

    await expect(
      handleSubmitEventRequest({ id: draft.id }, organiser, database as never)
    ).rejects.toThrow(missingFieldsMessage(["Equipment requirements"]));

    expect(await findById(draft.id)).toMatchObject({
      status: "draft",
      submittedAt: null,
    });
  });

  it("flips a complete draft to submitted and records the submission time (AC2)", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const before = Date.now();

    const submitted = await handleSubmitEventRequest(
      { id: draft.id },
      organiser,
      database as never
    );

    expect(submitted).toMatchObject({ id: draft.id, status: "submitted" });
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    expect(submitted.submittedAt?.getTime()).toBeGreaterThanOrEqual(before);
    // AC5: submission keeps the row readable in place. The internal review list reads that
    // data. PTR-17 builds that view.
    expect(await findById(draft.id)).toEqual(submitted);
  });

  it("refuses to edit a submitted request, directing to a clarification or change request (AC3)", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const submitted = await handleSubmitEventRequest(
      { id: draft.id },
      organiser,
      database as never
    );

    await expect(
      handleSaveEventRequestDraft(
        { id: draft.id, eventName: "Changed after submission" },
        organiser,
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: SUBMITTED_EDIT_REFUSAL,
    });

    expect(await findById(draft.id)).toEqual(submitted);
  });

  it("refuses a second submission of the same request", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    await handleSubmitEventRequest({ id: draft.id }, organiser, database as never);

    await expect(
      handleSubmitEventRequest({ id: draft.id }, organiser, database as never)
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: ALREADY_SUBMITTED_MESSAGE,
    });
  });

  it("refuses to submit a draft that belongs to another organiser", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);

    await expect(
      handleSubmitEventRequest({ id: draft.id }, otherOrganiser, database as never)
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    expect(await findById(draft.id)).toMatchObject({ status: "draft" });
  });

  it("refuses an id that matches no draft instead of inventing one", async () => {
    await expect(
      handleSubmitEventRequest({ id: 987654 }, organiser, database as never)
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    expect(await ownedRequestCount(database)).toBe(0);
  });

  /** Check the persistence invariant on every path that writes the row. */
  it("refuses a submission time that disagrees with the status", async () => {
    await expect(
      database
        .insert(schema.eventRequests)
        .values({ organiserId: organiser.id, status: "submitted" })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_submission_time_matches_status" },
    });

    await expect(
      database.insert(schema.eventRequests).values({
        organiserId: organiser.id,
        status: "draft",
        submittedAt: new Date(),
      })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_submission_time_matches_status" },
    });
  });
});

const byId = (a: number, b: number) => a - b;

describe("Listing and reading an organiser's requests (PTR-14)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  it("lists the organiser's own requests only, drafts and submitted alike (AC1)", async () => {
    const draft = await handleSaveEventRequestDraft(
      { eventName: "My draft" },
      organiser,
      database as never
    );
    const complete = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const submitted = await handleSubmitEventRequest(
      { id: complete.id },
      organiser,
      database as never
    );
    await handleSaveEventRequestDraft(
      { eventName: "Someone else's" },
      otherOrganiser,
      database as never
    );

    const listed = await handleListEventRequests(organiser, database as never);

    expect(listed.map(row => row.id).toSorted(byId)).toEqual(
      [draft.id, submitted.id].toSorted(byId)
    );
    expect(listed.map(row => row.status).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "draft",
      "submitted",
    ]);
    expect(listed.every(row => row.organiserId === organiser.id)).toBe(true);
  });

  it("lists the most recently changed request first", async () => {
    const older = await handleSaveEventRequestDraft(
      { eventName: "Older" },
      organiser,
      database as never
    );
    const newer = await handleSaveEventRequestDraft(
      { eventName: "Newer" },
      organiser,
      database as never
    );
    // Compare across different milliseconds. Postgres timestamps carry more precision than the
    // save path's JavaScript Date.
    await database
      .update(schema.eventRequests)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.eventRequests.id, newer.id));
    await handleSaveEventRequestDraft(
      { id: older.id, eventName: "Older, revised" },
      organiser,
      database as never
    );

    const listed = await handleListEventRequests(organiser, database as never);

    expect(listed.map(row => row.id)).toEqual([older.id, newer.id]);
  });

  it("reads one of the organiser's requests as recorded (AC4)", async () => {
    const saved = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);

    const read = await handleGetEventRequest({ id: saved.id }, organiser, database as never);

    expect(read).toEqual({
      ...saved,
      coordinator: null,
      clarifications: [],
      changeRequests: [],
      cancellationRequests: [],
    });
  });

  it("answers null for another organiser's request and for an id that does not exist", async () => {
    const theirs = await handleSaveEventRequestDraft(
      { eventName: "Theirs" },
      otherOrganiser,
      database as never
    );

    expect(await handleGetEventRequest({ id: theirs.id }, organiser, database as never)).toBeNull();
    expect(await handleGetEventRequest({ id: 999_999 }, organiser, database as never)).toBeNull();
  });

  it("refuses an id that is not a positive whole number", async () => {
    await expect(handleGetEventRequest({ id: "41" }, organiser, database as never)).rejects.toThrow(
      "Choose an event request"
    );
  });
});

describe("Reopening, saving, and deleting a draft (PTR-12)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  // Criterion 2: reopening returns exactly what was saved. A draft that is not the
  // organiser's own never reopens.
  it("reopens a draft with its exact stored values, and answers null for one that is not reopenable (PTR-12)", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const reopened = await handleGetEventRequestDraft(
      { id: draft.id },
      organiser,
      database as never
    );
    expect(reopened).toEqual(draft);

    const submitted = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    await handleSubmitEventRequest({ id: submitted.id }, organiser, database as never);

    expect(
      await handleGetEventRequestDraft({ id: submitted.id }, organiser, database as never)
    ).toBeNull();

    const theirs = await handleSaveEventRequestDraft(
      { eventName: "Not yours" },
      otherOrganiser,
      database as never
    );
    expect(
      await handleGetEventRequestDraft({ id: theirs.id }, organiser, database as never)
    ).toBeNull();
    expect(
      await handleGetEventRequestDraft({ id: 999_999 }, organiser, database as never)
    ).toBeNull();
  });

  // Criterion 2: repeat the cycle any number of times. Every save updates the same row.
  it("keeps updating the same reopened draft across repeated edits (PTR-12)", async () => {
    const created = await handleSaveEventRequestDraft(
      { eventName: "First name" },
      organiser,
      database as never
    );

    const secondSave = await handleSaveEventRequestDraft(
      { id: created.id, eventName: "Second name" },
      organiser,
      database as never
    );
    const thirdSave = await handleSaveEventRequestDraft(
      { id: created.id, eventName: "Third name" },
      organiser,
      database as never
    );

    expect(secondSave.id).toBe(created.id);
    expect(thirdSave.id).toBe(created.id);
    expect(thirdSave).toMatchObject({
      eventName: "Third name",
      status: "draft",
    });
    expect(await ownedRequestCount(database)).toBe(1);
  });

  // Criterion 3: deleting an owned draft removes it. It never reopens.
  it("deletes an owned draft so it can no longer be listed or reopened (PTR-12)", async () => {
    const draft = await handleSaveEventRequestDraft(
      { eventName: "Throwaway draft" },
      organiser,
      database as never
    );

    const deleted = await handleDeleteEventRequestDraft(
      { id: draft.id },
      organiser,
      database as never
    );
    expect(deleted.id).toBe(draft.id);

    expect(
      await handleGetEventRequestDraft({ id: draft.id }, organiser, database as never)
    ).toBeNull();

    const list = await handleListEventRequests(organiser, database as never);
    expect(list).toHaveLength(0);
  });

  // Criterion 3 guard: a submitted request survives a direct delete call. Another
  // organiser's draft survives it too.
  it("refuses to delete a submitted request or another organiser's draft (PTR-12)", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);

    const submitted = await handleSubmitEventRequest(
      { id: draft.id },
      organiser,
      database as never
    );

    await expect(
      handleDeleteEventRequestDraft({ id: submitted.id }, organiser, database as never)
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EVENT_REQUEST_DELETE_REFUSAL,
    });

    expect(await ownedRequestCount(database)).toBe(1);

    const othersDraft = await handleSaveEventRequestDraft(
      { eventName: "Not yours" },
      otherOrganiser,
      database as never
    );

    await expect(
      handleDeleteEventRequestDraft({ id: othersDraft.id }, organiser, database as never)
    ).rejects.toMatchObject({
      name: "AuthorizationError",
      status: 403,
    });

    expect(await ownedRequestCount(database)).toBe(2);
  });
});

/**
 * Two Coordinators beside the seeded one, created in a known order for the tie-break test.
 * Both dates sit far in the past, so both sort before the seeded account no matter when the
 * database was seeded.
 */
const extraCoordinators = [
  {
    id: "test-coordinator-a",
    name: "Coordinator A",
    email: "coordinator.a@example.com",
    emailVerified: true,
    role: "event_coordinator",
    createdAt: new Date("2000-01-01T00:00:00Z"),
  },
  {
    id: "test-coordinator-b",
    name: "Coordinator B",
    email: "coordinator.b@example.com",
    emailVerified: true,
    role: "event_coordinator",
    createdAt: new Date("2000-01-02T00:00:00Z"),
  },
];

/**
 * A third file-owned Coordinator, created after the other two. The seeded Coordinator carries
 * the demo event as load, so the tie-break test uses this account for its third step. It checks
 * no seed state that this file does not own. It stays out of `extraCoordinators`, so the two-way
 * race cases keep exactly two racers.
 */
const tieBreakCoordinator = {
  id: "test-coordinator-c",
  name: "Coordinator C",
  email: "coordinator.c@example.com",
  emailVerified: true,
  role: "event_coordinator",
  createdAt: new Date("2000-01-03T00:00:00Z"),
};

const fixtureCoordinators = [...extraCoordinators, tieBreakCoordinator];

/** The Lead account this file's PTR-144 submission tests notify. Seeded Leads also exist. */
const fixtureLead = {
  id: "test-lead-144",
  name: "PTR-144 Lead",
  email: "lead.144@example.com",
  emailVerified: true,
  role: "event_coordinator_lead",
};

const lead: SessionUser = {
  id: fixtureLead.id,
  email: fixtureLead.email,
  role: "event_coordinator_lead",
};

async function submitNew(
  values: EventRequestDraftValues,
  who: SessionUser,
  database: ReturnType<typeof drizzle<typeof schema>>
) {
  const saved = await handleSaveEventRequestDraft(values, who, database as never);
  return handleSubmitEventRequest({ id: saved.id }, who, database as never);
}

describe("Coordinating event requests (PTR-15, PTR-17, PTR-20, PTR-110, PTR-144)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    // Create the fixtures far in the past for the earliest-account tie-break. Date them after
    // the two known accounts, so those accounts win in order.
    await database.insert(schema.user).values(fixtureCoordinators).onConflictDoNothing();
    await database.insert(schema.user).values(fixtureLead).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.user)
      .where(inArray(schema.user.id, [...fixtureCoordinators.map(c => c.id), fixtureLead.id]));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  /** Submit a fresh request, then record its assignment to `coordinatorId` in SQL. There is no
   * assign handler anymore (PTR-144): a submission never auto-assigns, so the test assigns the
   * row the way the queue would. */
  async function assignedRequest(coordinatorId: string = extraCoordinators[0].id) {
    const submitted = await submitNew(fullRequest, organiser, database);
    const [row] = await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: coordinatorId, assignedAt: new Date() })
      .where(eq(schema.eventRequests.id, submitted.id))
      .returning();
    return row;
  }

  /** Build a submitted row. Assign it to `coordinatorId`, or leave it unassigned when null. */
  async function submittedRequest(coordinatorId: string | null) {
    const saved = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    const [row] = await database
      .update(schema.eventRequests)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        assignedAt: coordinatorId ? new Date() : null,
      })
      .where(eq(schema.eventRequests.id, saved.id))
      .returning();
    return row;
  }

  async function statusOf(id: number) {
    const rows = await database
      .select({ status: schema.eventRequests.status })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, id));
    return rows.at(0)?.status;
  }

  describe("accepting or declining a handover (PTR-110)", () => {
    const outgoing = extraCoordinators[0];
    const incoming = extraCoordinators[1];

    async function pendingHandover() {
      const request = await assignedRequest();
      const handover = await handleRequestEventHandover(
        { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: outgoing.id },
        outgoing,
        database as never
      );
      return { request, handover };
    }

    it("records a pending offer, keeps the outgoing Coordinator assigned, and queues the incoming notification (AC1, AC2)", async () => {
      const request = await assignedRequest();
      const handover = await handleRequestEventHandover(
        {
          id: request.id,
          coordinatorId: incoming.id,
          expectedCoordinatorId: outgoing.id,
          actorId: "forged",
        },
        outgoing,
        database as never
      );

      expect(handover).toMatchObject({
        eventRequestId: request.id,
        fromCoordinatorId: outgoing.id,
        toCoordinatorId: incoming.id,
        decision: null,
        decidedById: null,
        decidedAt: null,
      });
      expect(handover.requestedAt).toBeInstanceOf(Date);

      // The assignment stays put. Only the outgoing Coordinator keeps access. The outgoing
      // page shows the live offer. The assigned list labels it.
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(stored.assignedCoordinatorId).toBe(outgoing.id);
      expect(stored.assignedAt).toEqual(request.assignedAt);
      const outgoingView = await handleGetCoordinationRequest(
        { id: request.id },
        outgoing,
        database as never
      );
      expect(outgoingView).toMatchObject({
        assignedCoordinatorId: outgoing.id,
        pendingHandover: { requestedAt: handover.requestedAt, toName: incoming.name },
      });
      const [outgoingRow] = await handleListAssignedEventRequests(outgoing, database as never);
      expect(outgoingRow.handoverTo).toBe(incoming.name);
      await expect(
        handleGetCoordinationRequest({ id: request.id }, incoming, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(await database.select().from(schema.eventAssignments)).toEqual([]);

      // Show the offer to the incoming Coordinator with all page content. Include the
      // coordination link in the queued notification.
      const pending = await handleListPendingEventHandovers(incoming, database as never);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: handover.id,
        requestedAt: handover.requestedAt,
        eventName: request.eventName,
        organiser: { name: "Drafts Organiser" },
        from: { name: outgoing.name },
      });
      expect(await handleListPendingEventHandovers(outgoing, database as never)).toEqual([]);
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, incoming.id),
            eq(schema.notifications.kind, "handover_requested")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].payload).toMatchObject({
        eventName: request.eventName.trim(),
        fromName: outgoing.name,
      });
      expect(
        notificationSummary({ kind: queued[0].kind, payload: queued[0].payload } as never)
      ).toContain(request.eventName.trim());
      expect(
        await render(
          renderNotificationEmail({
            kind: queued[0].kind,
            payload: queued[0].payload,
            eventRequestId: request.id,
          } as never).element
        )
      ).toContain("/coordination");
    });

    it("accepts a handover: moves the assignment, records it, and queues the Organiser notification (AC3)", async () => {
      const { request, handover } = await pendingHandover();
      const accepted = await handleAcceptEventHandover(
        { id: handover.id },
        incoming,
        database as never
      );

      expect(accepted).toMatchObject({ decision: "accepted", decidedById: incoming.id });
      expect(accepted.decidedAt).toBeInstanceOf(Date);

      const assignments = await database.select().from(schema.eventAssignments);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({
        eventRequestId: request.id,
        fromCoordinatorId: outgoing.id,
        toCoordinatorId: incoming.id,
        actorId: incoming.id,
      });
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(stored.assignedCoordinatorId).toBe(incoming.id);
      // The move stamps its own time. It matches the audit entry.
      expect(stored.assignedAt).toEqual(assignments[0].createdAt);

      // Move access to the new Coordinator. Show the new Coordinator to the Organiser.
      await expect(
        handleGetCoordinationRequest({ id: request.id }, outgoing, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await handleGetCoordinationRequest({ id: request.id }, incoming, database as never)
      ).toMatchObject({ assignedCoordinatorId: incoming.id });
      expect(await handleListAssignedEventRequests(outgoing, database as never)).toEqual([]);
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({ coordinator: { name: incoming.name, email: incoming.email } });
      const acceptedQueued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "handover_accepted")
          )
        );
      expect(acceptedQueued).toHaveLength(1);
      expect(acceptedQueued[0].emailedAt).toBeNull();
      expect(acceptedQueued[0].payload).toMatchObject({ coordinatorName: incoming.name });
      expect(
        notificationSummary({
          kind: acceptedQueued[0].kind,
          payload: acceptedQueued[0].payload,
        } as never)
      ).toContain("new Coordinator");
      expect(
        await render(
          renderNotificationEmail({
            kind: acceptedQueued[0].kind,
            payload: acceptedQueued[0].payload,
            eventRequestId: request.id,
          } as never).element
        )
      ).toContain(`/events/${request.id}`);
    });

    it("declines a handover: the event stays with the outgoing Coordinator, the answer is recorded, and the outgoing notification is queued (AC4)", async () => {
      const { request, handover } = await pendingHandover();
      const declined = await handleDeclineEventHandover(
        { id: handover.id },
        incoming,
        database as never
      );

      expect(declined).toMatchObject({ decision: "declined", decidedById: incoming.id });
      expect(declined.decidedAt).toBeInstanceOf(Date);
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(stored.assignedCoordinatorId).toBe(outgoing.id);
      expect(await database.select().from(schema.eventAssignments)).toEqual([]);
      expect(
        await handleGetCoordinationRequest({ id: request.id }, outgoing, database as never)
      ).toMatchObject({ assignedCoordinatorId: outgoing.id });
      const declinedQueued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, outgoing.id),
            eq(schema.notifications.kind, "handover_declined")
          )
        );
      expect(declinedQueued).toHaveLength(1);
      expect(declinedQueued[0].emailedAt).toBeNull();
      expect(declinedQueued[0].payload).toMatchObject({ coordinatorName: incoming.name });
      expect(
        notificationSummary({
          kind: declinedQueued[0].kind,
          payload: declinedQueued[0].payload,
        } as never)
      ).toContain("Handover declined");
      expect(
        await render(
          renderNotificationEmail({
            kind: declinedQueued[0].kind,
            payload: declinedQueued[0].payload,
            eventRequestId: request.id,
          } as never).element
        )
      ).toContain(`/events/${request.id}`);
      await expect(
        handleAcceptEventHandover({ id: handover.id }, incoming, database as never)
      ).rejects.toMatchObject({ status: 409 });
    });

    it("replaces the live offer when the outgoing Coordinator chooses someone else", async () => {
      const { request, handover } = await pendingHandover();
      const replacement = await handleRequestEventHandover(
        {
          id: request.id,
          coordinatorId: tieBreakCoordinator.id,
          expectedCoordinatorId: outgoing.id,
        },
        outgoing,
        database as never
      );

      expect(replacement.id).not.toBe(handover.id);
      const live = await database
        .select()
        .from(schema.eventHandovers)
        .where(eq(schema.eventHandovers.eventRequestId, request.id));
      expect(live).toHaveLength(1);
      expect(live[0].toCoordinatorId).toBe(tieBreakCoordinator.id);
      expect(await handleListPendingEventHandovers(incoming, database as never)).toEqual([]);
    });

    it("refuses a raise from another Coordinator, to a non-Coordinator, to the assignee, on a decision, and on a stale observation", async () => {
      const request = await assignedRequest();
      await expect(
        handleRequestEventHandover(
          {
            id: request.id,
            coordinatorId: tieBreakCoordinator.id,
            expectedCoordinatorId: outgoing.id,
          },
          incoming,
          database as never
        )
      ).rejects.toMatchObject({ status: 403 });

      await Promise.all(
        [organiser.id, "deleted-account", outgoing.id].map(async coordinatorId => {
          await expect(
            handleRequestEventHandover(
              { id: request.id, coordinatorId, expectedCoordinatorId: outgoing.id },
              outgoing,
              database as never
            )
          ).rejects.toMatchObject({ status: 409 });
        })
      );
      await expect(
        handleRequestEventHandover(
          { id: request.id, coordinatorId: tieBreakCoordinator.id, expectedCoordinatorId: null },
          outgoing,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });

      await handleTakeUpForReview({ id: request.id }, outgoing, database as never);
      await handleDecideEventRequest(
        { id: request.id, decision: "approved" },
        outgoing,
        database as never
      );
      await expect(
        handleRequestEventHandover(
          {
            id: request.id,
            coordinatorId: tieBreakCoordinator.id,
            expectedCoordinatorId: outgoing.id,
          },
          outgoing,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(await database.select().from(schema.eventHandovers)).toEqual([]);
    });

    it("refuses an answer from anyone but the addressed Coordinator, and answers once", async () => {
      const { handover } = await pendingHandover();
      await expect(
        handleAcceptEventHandover({ id: handover.id }, outgoing, database as never)
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        handleDeclineEventHandover({ id: handover.id }, tieBreakCoordinator, database as never)
      ).rejects.toMatchObject({ status: 403 });
      // Refuse a missing id in the same way. The serial id space reveals nothing.
      await expect(
        handleAcceptEventHandover({ id: 999_999 }, incoming, database as never)
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        handleDeclineEventHandover({ id: 999_999 }, incoming, database as never)
      ).rejects.toMatchObject({ status: 403 });

      await handleDeclineEventHandover({ id: handover.id }, incoming, database as never);
      await expect(
        handleAcceptEventHandover({ id: handover.id }, incoming, database as never)
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        handleDeclineEventHandover({ id: handover.id }, incoming, database as never)
      ).rejects.toMatchObject({ status: 409 });
    });

    it("allows only one of a simultaneous accept and decline", async () => {
      const { request, handover } = await pendingHandover();
      const results = await Promise.allSettled([
        handleAcceptEventHandover({ id: handover.id }, incoming, database as never),
        handleDeclineEventHandover({ id: handover.id }, incoming, database as never),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const [answered] = await database
        .select()
        .from(schema.eventHandovers)
        .where(eq(schema.eventHandovers.id, handover.id));
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(answered.decision).not.toBeNull();
      expect(stored.assignedCoordinatorId).toBe(
        answered.decision === "accepted" ? incoming.id : outgoing.id
      );
    });

    it("resolves an offer the request has moved past, rather than leaving it pending", async () => {
      const vacated = {
        id: "test-coordinator-vacated",
        name: "Vacated Coordinator",
        email: "coordinator.vacated@example.com",
        emailVerified: true,
        role: "event_coordinator",
        createdAt: new Date("1999-06-01T00:00:00Z"),
      };
      await database.insert(schema.user).values(vacated).onConflictDoNothing();
      try {
        const request = await submittedRequest(null);
        // PTR-144: no assign handler exists. Record the assignment in SQL, as the queue would.
        await database
          .update(schema.eventRequests)
          .set({ assignedCoordinatorId: vacated.id, assignedAt: new Date() })
          .where(eq(schema.eventRequests.id, request.id));
        const handover = await handleRequestEventHandover(
          { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: vacated.id },
          { id: vacated.id, email: vacated.email, name: vacated.name, role: "event_coordinator" },
          database as never
        );

        // Deleting the outgoing account clears the assignment. Another Coordinator picks the
        // request up for real.
        await database.delete(schema.user).where(eq(schema.user.id, vacated.id));
        const [vacatedRow] = await database
          .select()
          .from(schema.eventRequests)
          .where(eq(schema.eventRequests.id, request.id));
        expect(vacatedRow.assignedCoordinatorId).toBeNull();
        // Another Coordinator takes the request. Record it in SQL, as the queue would.
        await database
          .update(schema.eventRequests)
          .set({ assignedCoordinatorId: tieBreakCoordinator.id, assignedAt: new Date() })
          .where(eq(schema.eventRequests.id, request.id));

        // Hide the previous assignment's offer from the new assignee's page.
        const newAssigneeView = await handleGetCoordinationRequest(
          { id: request.id },
          tieBreakCoordinator,
          database as never
        );
        expect(newAssigneeView.pendingHandover).toBeNull();
        const [newAssigneeRow] = await handleListAssignedEventRequests(
          tieBreakCoordinator,
          database as never
        );
        expect(newAssigneeRow.handoverTo).toBeNull();
        expect(await handleListPendingEventHandovers(incoming, database as never)).toEqual([]);

        // A late accept still records who answered and when. It queues no false notice.
        await expect(
          handleAcceptEventHandover({ id: handover.id }, incoming, database as never)
        ).rejects.toMatchObject({ status: 409 });
        const [resolved] = await database
          .select()
          .from(schema.eventHandovers)
          .where(eq(schema.eventHandovers.id, handover.id));
        expect(resolved).toMatchObject({ decision: "declined", decidedById: incoming.id });
        expect(resolved.decidedAt).toBeInstanceOf(Date);
        expect(
          await database
            .select()
            .from(schema.notifications)
            .where(
              and(
                eq(schema.notifications.eventRequestId, request.id),
                eq(schema.notifications.kind, "handover_accepted")
              )
            )
        ).toHaveLength(0);
      } finally {
        await database.delete(schema.user).where(eq(schema.user.id, vacated.id));
      }
    });

    it("does not list an offer for a decided request, and voids it on accept", async () => {
      const { request, handover } = await pendingHandover();
      await handleTakeUpForReview({ id: request.id }, outgoing, database as never);
      await handleDecideEventRequest(
        { id: request.id, decision: "approved" },
        outgoing,
        database as never
      );

      expect(await handleListPendingEventHandovers(incoming, database as never)).toEqual([]);
      const outgoingView = await handleGetCoordinationRequest(
        { id: request.id },
        outgoing,
        database as never
      );
      expect(outgoingView.pendingHandover).toBeNull();
      const [decidedRow] = await handleListAssignedEventRequests(outgoing, database as never);
      expect(decidedRow.handoverTo).toBeNull();

      await expect(
        handleAcceptEventHandover({ id: handover.id }, incoming, database as never)
      ).rejects.toMatchObject({ status: 409 });
      const [voided] = await database
        .select()
        .from(schema.eventHandovers)
        .where(eq(schema.eventHandovers.id, handover.id));
      expect(voided).toMatchObject({ decision: "declined", decidedById: incoming.id });
    });

    it("queues the handover notification with the recorded offer", async () => {
      const request = await assignedRequest();
      const handover = await handleRequestEventHandover(
        { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: outgoing.id },
        outgoing,
        database as never
      );

      expect(handover.decision).toBeNull();
      expect(await database.select().from(schema.eventHandovers)).toHaveLength(1);
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, incoming.id),
            eq(schema.notifications.kind, "handover_requested")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(
        notificationSummary({ kind: queued[0].kind, payload: queued[0].payload } as never)
      ).toContain("Handover requested");
    });

    it("refuses a partial decision and a second live offer at the database", async () => {
      const { request } = await pendingHandover();

      // The CHECK keeps decision attribution all-or-nothing.
      await expect(
        database.insert(schema.eventHandovers).values({
          eventRequestId: request.id,
          fromCoordinatorId: outgoing.id,
          toCoordinatorId: tieBreakCoordinator.id,
          decision: "accepted",
        })
      ).rejects.toMatchObject({
        cause: { constraint: "event_handovers_decision_complete" },
      });
      // The partial unique index allows one live offer per event.
      await expect(
        database.insert(schema.eventHandovers).values({
          eventRequestId: request.id,
          fromCoordinatorId: outgoing.id,
          toCoordinatorId: tieBreakCoordinator.id,
        })
      ).rejects.toMatchObject({
        cause: { constraint: "event_handovers_pending_event_idx" },
      });
    });

    it("declines an offer the request has moved past without a false notice", async () => {
      const { request, handover } = await pendingHandover();
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: tieBreakCoordinator.id, assignedAt: new Date() })
        .where(eq(schema.eventRequests.id, request.id));

      const declined = await handleDeclineEventHandover(
        { id: handover.id },
        incoming,
        database as never
      );
      expect(declined).toMatchObject({ decision: "declined", decidedById: incoming.id });
      expect(declined.decidedAt).toBeInstanceOf(Date);
      // Send the outgoing Coordinator no "you remain" notice. They do not remain.
      expect(
        await database
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.eventRequestId, request.id),
              eq(schema.notifications.kind, "handover_declined")
            )
          )
      ).toHaveLength(0);
    });

    it("queues accept and decline notifications with the committed handover answers", async () => {
      const accepted = await pendingHandover();
      await handleAcceptEventHandover({ id: accepted.handover.id }, incoming, database as never);
      const [acceptedRow] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, accepted.request.id));
      expect(acceptedRow.assignedCoordinatorId).toBe(incoming.id);
      const acceptedQueued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, accepted.request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "handover_accepted")
          )
        );
      expect(acceptedQueued).toHaveLength(1);
      expect(acceptedQueued[0].emailedAt).toBeNull();

      const declined = await pendingHandover();
      await handleDeclineEventHandover({ id: declined.handover.id }, incoming, database as never);
      const [declinedRow] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, declined.request.id));
      expect(declinedRow.assignedCoordinatorId).toBe(outgoing.id);
      const [declinedHandover] = await database
        .select()
        .from(schema.eventHandovers)
        .where(eq(schema.eventHandovers.id, declined.handover.id));
      expect(declinedHandover.decision).toBe("declined");
      const declinedQueued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, declined.request.id),
            eq(schema.notifications.recipientId, outgoing.id),
            eq(schema.notifications.kind, "handover_declined")
          )
        );
      expect(declinedQueued).toHaveLength(1);
      expect(declinedQueued[0].emailedAt).toBeNull();
    });

    it("allows only one of a simultaneous replacement and accept", async () => {
      const { request, handover } = await pendingHandover();
      const results = await Promise.allSettled([
        handleRequestEventHandover(
          {
            id: request.id,
            coordinatorId: tieBreakCoordinator.id,
            expectedCoordinatorId: outgoing.id,
          },
          outgoing,
          database as never
        ),
        handleAcceptEventHandover({ id: handover.id }, incoming, database as never),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const [stored] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      const live = await database
        .select()
        .from(schema.eventHandovers)
        .where(
          and(
            eq(schema.eventHandovers.eventRequestId, request.id),
            isNull(schema.eventHandovers.decision)
          )
        );
      // Either outcome passes: an accept moves the event with no waiting offer, or the
      // replacement keeps the event with one fresh offer. Check the whole outcome at once.
      const outcome = {
        assignedCoordinatorId: stored.assignedCoordinatorId,
        liveCount: live.length,
        liveTo: live.at(0)?.toCoordinatorId ?? null,
      };
      expect(outcome).toEqual(
        stored.assignedCoordinatorId === incoming.id
          ? { assignedCoordinatorId: incoming.id, liveCount: 0, liveTo: null }
          : {
              assignedCoordinatorId: outgoing.id,
              liveCount: 1,
              liveTo: tieBreakCoordinator.id,
            }
      );
    });

    it("settles a simultaneous replacement and decline without losing the new offer", async () => {
      const { request, handover } = await pendingHandover();
      const results = await Promise.allSettled([
        handleRequestEventHandover(
          {
            id: request.id,
            coordinatorId: tieBreakCoordinator.id,
            expectedCoordinatorId: outgoing.id,
          },
          outgoing,
          database as never
        ),
        handleDeclineEventHandover({ id: handover.id }, incoming, database as never),
      ]);

      // The raise always succeeds. The decline beats the replacement or finds it gone.
      expect(results[0].status).toBe("fulfilled");
      const live = await database
        .select()
        .from(schema.eventHandovers)
        .where(
          and(
            eq(schema.eventHandovers.eventRequestId, request.id),
            isNull(schema.eventHandovers.decision)
          )
        );
      expect(live).toHaveLength(1);
      expect(live[0].toCoordinatorId).toBe(tieBreakCoordinator.id);
    });

    it("hides an offer whose incoming account no longer exists", async () => {
      const { request } = await pendingHandover();
      await database.delete(schema.user).where(eq(schema.user.id, incoming.id));
      try {
        const outgoingView = await handleGetCoordinationRequest(
          { id: request.id },
          outgoing,
          database as never
        );
        expect(outgoingView.pendingHandover).toBeNull();
        const [outgoingRow] = await handleListAssignedEventRequests(outgoing, database as never);
        expect(outgoingRow.handoverTo).toBeNull();

        // The outgoing Coordinator offers it anew. The new row replaces the dead row.
        const replacement = await handleRequestEventHandover(
          {
            id: request.id,
            coordinatorId: tieBreakCoordinator.id,
            expectedCoordinatorId: outgoing.id,
          },
          outgoing,
          database as never
        );
        expect(replacement.toCoordinatorId).toBe(tieBreakCoordinator.id);
        expect(
          await database
            .select()
            .from(schema.eventHandovers)
            .where(eq(schema.eventHandovers.eventRequestId, request.id))
        ).toHaveLength(1);
      } finally {
        // Restore the file-owned fixture that the other tests share.
        await database.insert(schema.user).values(extraCoordinators[1]).onConflictDoNothing();
      }
    });

    it("refuses an accept whose account was deleted before it lands", async () => {
      const { request, handover } = await pendingHandover();
      await database.delete(schema.user).where(eq(schema.user.id, incoming.id));
      try {
        // The share lock turns the raw FK 23503 into a typed refusal.
        await expect(
          handleAcceptEventHandover({ id: handover.id }, incoming, database as never)
        ).rejects.toMatchObject({ status: 409 });

        const [stored] = await database
          .select()
          .from(schema.eventRequests)
          .where(eq(schema.eventRequests.id, request.id));
        expect(stored.assignedCoordinatorId).toBe(outgoing.id);
        const [stillPending] = await database
          .select()
          .from(schema.eventHandovers)
          .where(eq(schema.eventHandovers.id, handover.id));
        expect(stillPending.decision).toBeNull();
      } finally {
        await database.insert(schema.user).values(extraCoordinators[1]).onConflictDoNothing();
      }
    });
  });

  describe("taking up a request for review (PTR-17)", () => {
    const actor = extraCoordinators[0];
    const other = extraCoordinators[1];

    it("refuses a different Coordinator and leaves the row submitted", async () => {
      const request = await submittedRequest(actor.id);
      await expect(
        handleTakeUpForReview({ id: request.id }, other, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(await statusOf(request.id)).toBe("submitted");
    });

    it("refuses an unassigned submitted request", async () => {
      const request = await submittedRequest(null);
      await expect(
        handleTakeUpForReview({ id: request.id }, actor, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(await statusOf(request.id)).toBe("submitted");
    });

    it("refuses a draft", async () => {
      const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
      await expect(
        handleTakeUpForReview({ id: draft.id }, actor, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(await statusOf(draft.id)).toBe("draft");
    });

    it("refuses a missing request", async () => {
      await expect(
        handleTakeUpForReview({ id: 2_147_483_647 }, actor, database as never)
      ).rejects.toMatchObject({ status: 403 });
    });

    it("refuses a repeat take-up of a request already under review", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);
      await expect(
        handleTakeUpForReview({ id: request.id }, actor, database as never)
      ).rejects.toMatchObject({ status: 409 });
      expect(await statusOf(request.id)).toBe("under_review");
    });

    it("marks a submitted request under review for its assigned Coordinator", async () => {
      const request = await submittedRequest(actor.id);
      const taken = await handleTakeUpForReview({ id: request.id }, actor, database as never);
      expect(taken).toMatchObject({
        id: request.id,
        status: "under_review",
        assignedCoordinatorId: actor.id,
      });
      expect(await statusOf(request.id)).toBe("under_review");
    });

    it("allows only one of two simultaneous take-ups, the loser seeing a conflict", async () => {
      const request = await submittedRequest(actor.id);
      const results = await Promise.allSettled([
        handleTakeUpForReview({ id: request.id }, actor, database as never),
        handleTakeUpForReview({ id: request.id }, actor, database as never),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(result => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ reason: { status: 409 } });
      expect(await statusOf(request.id)).toBe("under_review");
    });
  });

  describe("approving or rejecting a request (PTR-20)", () => {
    const actor = extraCoordinators[0];
    const other = extraCoordinators[1];

    async function underReviewRequest() {
      const request = await assignedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);
      return request;
    }

    it("approves an under-review request and records the Coordinator and time (AC1, AC3)", async () => {
      const request = await underReviewRequest();
      const approved = await handleDecideEventRequest(
        { id: request.id, decision: "approved" },
        actor,
        database as never
      );

      expect(approved).toMatchObject({
        status: "approved",
        decisionReason: null,
        decidedByCoordinatorId: actor.id,
        decidedByCoordinatorName: actor.name,
      });
      expect(approved.decidedAt).toBeInstanceOf(Date);
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({
        status: "approved",
        decidedByCoordinatorId: actor.id,
        decidedByCoordinatorName: actor.name,
        decidedAt: approved.decidedAt,
      });
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "event_decided")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].payload).toMatchObject({ decision: "approved" });
      expect(
        notificationSummary({ kind: queued[0].kind, payload: queued[0].payload } as never)
      ).toContain("was approved");
    });

    it("requires a rejection reason, then records it and queues the Organiser notification (AC2, AC4)", async () => {
      const request = await underReviewRequest();

      await expect(
        handleDecideEventRequest(
          { id: request.id, decision: "rejected", reason: " " },
          actor,
          database as never
        )
      ).rejects.toThrow("Enter a reason to reject this request");
      // The refused decision queues nothing. The submission receipt and Lead notices stay.
      expect(
        await database
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.eventRequestId, request.id),
              eq(schema.notifications.kind, "event_decided")
            )
          )
      ).toHaveLength(0);

      const rejected = await handleDecideEventRequest(
        { id: request.id, decision: "rejected", reason: "  Venue unavailable  " },
        actor,
        database as never
      );
      expect(rejected).toMatchObject({
        status: "rejected",
        decisionReason: "Venue unavailable",
        decidedByCoordinatorId: actor.id,
        decidedByCoordinatorName: actor.name,
      });
      const rejectedQueued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "event_decided")
          )
        );
      expect(rejectedQueued).toHaveLength(1);
      expect(rejectedQueued[0].emailedAt).toBeNull();
      expect(rejectedQueued[0].payload).toMatchObject({
        decision: "rejected",
        reason: "Venue unavailable",
      });
      expect(
        notificationSummary({
          kind: rejectedQueued[0].kind,
          payload: rejectedQueued[0].payload,
        } as never)
      ).toContain("was rejected");
    });

    it("refuses the wrong Coordinator, a pre-review request and a second decision", async () => {
      const request = await underReviewRequest();
      // A submitted request the queue assigned to the acting Coordinator: deciding it before
      // review is refused with 409, not 403.
      const submitted = await assignedRequest(actor.id);

      await expect(
        handleDecideEventRequest({ id: request.id, decision: "approved" }, other, database as never)
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        handleDecideEventRequest(
          { id: submitted.id, decision: "approved" },
          actor,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });

      await handleDecideEventRequest(
        { id: request.id, decision: "approved" },
        actor,
        database as never
      );
      await expect(
        handleDecideEventRequest(
          { id: request.id, decision: "rejected", reason: "Changed mind" },
          actor,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });
    });

    it("allows only one competing decision and queues one notification", async () => {
      const request = await underReviewRequest();
      const results = await Promise.allSettled([
        handleDecideEventRequest(
          { id: request.id, decision: "approved" },
          actor,
          database as never
        ),
        handleDecideEventRequest(
          { id: request.id, decision: "rejected", reason: "Venue unavailable" },
          actor,
          database as never
        ),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      expect(
        await database
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.eventRequestId, request.id),
              eq(schema.notifications.kind, "event_decided")
            )
          )
      ).toHaveLength(1);
    });

    it("queues the decision notification with the committed decision", async () => {
      const request = await underReviewRequest();

      const approved = await handleDecideEventRequest(
        { id: request.id, decision: "approved" },
        actor,
        database as never
      );

      expect(approved.status).toBe("approved");
      expect(
        await handleGetCoordinationRequest({ id: request.id }, actor, database as never)
      ).toMatchObject({
        status: "approved",
        decidedAt: approved.decidedAt,
        decidedByCoordinatorId: actor.id,
      });
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "event_decided")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
    });

    it("enforces decision attribution and rejection reasons at the database boundary", async () => {
      const request = await underReviewRequest();
      await expect(
        database
          .update(schema.eventRequests)
          .set({
            status: "rejected",
            decidedByCoordinatorId: actor.id,
            decidedByCoordinatorName: actor.name,
            decidedAt: new Date(),
            decisionReason: null,
          })
          .where(eq(schema.eventRequests.id, request.id))
      ).rejects.toMatchObject({
        cause: { constraint: "event_requests_rejection_has_reason" },
      });

      // The rejected update left the row untouched. The request still enforces the attribution
      // CHECK. Approval with null decision fields fails closed.
      await expect(
        database
          .update(schema.eventRequests)
          .set({ status: "approved" })
          .where(eq(schema.eventRequests.id, request.id))
      ).rejects.toMatchObject({
        cause: { constraint: "event_requests_decision_matches_status" },
      });
    });
  });

  describe("handleRaiseClarificationRequest (PTR-18)", () => {
    const actor = extraCoordinators[0];
    const other = extraCoordinators[1];

    it("refuses a different Coordinator (403)", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);
      await expect(
        handleRaiseClarificationRequest(
          { id: request.id, body: "Need more info" },
          other,
          database as never
        )
      ).rejects.toMatchObject({ status: 403 });
      expect(await statusOf(request.id)).toBe("under_review");
    });

    it("refuses an unassigned request (403)", async () => {
      const request = await submittedRequest(null);
      await expect(
        handleRaiseClarificationRequest(
          { id: request.id, body: "Need more info" },
          actor,
          database as never
        )
      ).rejects.toMatchObject({ status: 403 });
    });

    it("refuses a submitted request that is not yet under review (409)", async () => {
      const request = await submittedRequest(actor.id);
      await expect(
        handleRaiseClarificationRequest(
          { id: request.id, body: "Need more info" },
          actor,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(await statusOf(request.id)).toBe("submitted");
    });

    it("records a clarification request and transitions status to awaiting_organiser (AC1, AC2)", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);

      const clarification = await handleRaiseClarificationRequest(
        { id: request.id, body: "Please specify dietary requirements." },
        actor,
        database as never
      );

      expect(clarification).toMatchObject({
        eventRequestId: request.id,
        coordinatorId: actor.id,
        body: "Please specify dietary requirements.",
      });
      expect(await statusOf(request.id)).toBe("awaiting_organiser");

      // Check that both parties can view the clarification (AC4).
      const coordView = await handleGetCoordinationRequest(
        { id: request.id },
        actor,
        database as never
      );
      expect(coordView.status).toBe("awaiting_organiser");
      expect(coordView.clarifications).toHaveLength(1);
      expect(coordView.clarifications[0].body).toBe("Please specify dietary requirements.");

      const orgView = await handleGetEventRequest({ id: request.id }, organiser, database as never);
      expect(orgView?.status).toBe("awaiting_organiser");
      expect(orgView?.clarifications).toHaveLength(1);
      expect(orgView?.clarifications[0].body).toBe("Please specify dietary requirements.");
    });

    it("queues the Organiser notification when a clarification is raised (AC3)", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);

      await handleRaiseClarificationRequest(
        { id: request.id, body: "Please specify dietary requirements." },
        actor,
        database as never
      );

      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "clarification_requested")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].payload).toMatchObject({
        eventName: "Community workshop",
        body: "Please specify dietary requirements.",
      });
      expect(
        notificationSummary({ kind: queued[0].kind, payload: queued[0].payload } as never)
      ).toBe("Clarification requested: Community workshop");
      expect(
        await render(
          renderNotificationEmail({
            kind: queued[0].kind,
            payload: queued[0].payload,
            eventRequestId: request.id,
          } as never).element
        )
      ).toContain("Please specify dietary requirements.");
    });

    it("queues the clarification notification with the raised question", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);

      const clarification = await handleRaiseClarificationRequest(
        { id: request.id, body: "Please specify dietary requirements." },
        actor,
        database as never
      );

      const stored = await database
        .select()
        .from(schema.clarificationRequests)
        .where(eq(schema.clarificationRequests.id, clarification.id));
      expect(stored).toHaveLength(1);
      expect(await statusOf(request.id)).toBe("awaiting_organiser");
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, request.id),
            eq(schema.notifications.recipientId, organiser.id),
            eq(schema.notifications.kind, "clarification_requested")
          )
        );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
    });

    it("accepts a second clarification request alongside the first (AC5 / Option A)", async () => {
      const request = await submittedRequest(actor.id);
      await handleTakeUpForReview({ id: request.id }, actor, database as never);

      await handleRaiseClarificationRequest(
        { id: request.id, body: "First question" },
        actor,
        database as never
      );
      await handleRaiseClarificationRequest(
        { id: request.id, body: "Second question" },
        actor,
        database as never
      );

      expect(await statusOf(request.id)).toBe("awaiting_organiser");

      const coordView = await handleGetCoordinationRequest(
        { id: request.id },
        actor,
        database as never
      );
      expect(coordView.clarifications).toHaveLength(2);
      expect(coordView.clarifications.map(c => c.body)).toEqual([
        "First question",
        "Second question",
      ]);
    });
  });

  describe("leaving submissions unassigned for the Lead queue (PTR-144)", () => {
    const coordinator: SessionUser = {
      id: extraCoordinators[0].id,
      email: extraCoordinators[0].email,
      role: "event_coordinator",
    };

    it("leaves a submission unassigned and lists it for the Lead queue", async () => {
      const submitted = await submitNew(fullRequest, organiser, database);

      expect(submitted).toMatchObject({
        id: submitted.id,
        status: "submitted",
        assignedCoordinatorId: null,
        assignedAt: null,
      });
      expect(submitted.submittedAt).toBeInstanceOf(Date);

      const unassigned = await handleListUnassignedEventRequests(database as never);
      expect(unassigned.map(row => row.id)).toContain(submitted.id);
      const row = unassigned.find(item => item.id === submitted.id);
      expect(row?.organiser).toEqual({
        name: "Drafts Organiser",
        email: "drafts.organiser@example.com",
      });
      expect(row).toMatchObject({ changeRequestsWaiting: 0, cancellationRequested: false });
    });

    it("carries the waiting change and cancellation counts on each unassigned row", async () => {
      const event = await submitNew(fullRequest, organiser, database);
      await handleRaiseEventChangeRequest(
        { id: event.id, whatShouldChange: "Venue", requestedValue: "Harbour Hall" },
        organiser,
        database as never
      );
      await handleRequestEventCancellation({ id: event.id }, organiser, database as never);

      const unassigned = await handleListUnassignedEventRequests(database as never);
      const row = unassigned.find(item => item.id === event.id);
      expect(row).toMatchObject({ changeRequestsWaiting: 1, cancellationRequested: true });
    });

    it("refuses a Coordinator the unassigned detail while the Lead reads it", async () => {
      const submitted = await submitNew(fullRequest, organiser, database);

      await expect(
        handleGetCoordinationRequest({ id: submitted.id }, coordinator, database as never)
      ).rejects.toMatchObject({ status: 403, message: "Forbidden" });

      const leadView = await handleGetCoordinationRequest(
        { id: submitted.id },
        lead,
        database as never
      );
      expect(leadView).toMatchObject({
        id: submitted.id,
        status: "submitted",
        assignedCoordinatorId: null,
      });

      // The assigned Coordinator keeps reading their own assignment.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: coordinator.id, assignedAt: new Date() })
        .where(eq(schema.eventRequests.id, submitted.id));
      await expect(
        handleGetCoordinationRequest({ id: submitted.id }, coordinator, database as never)
      ).resolves.toMatchObject({ assignedCoordinatorId: coordinator.id });
    });

    it("queues the organiser receipt and one notice per Lead on submission", async () => {
      const submitted = await submitNew(fullRequest, organiser, database);

      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, submitted.id),
            eq(schema.notifications.kind, "event_submitted")
          )
        );
      const receipt = queued.find(row => row.recipientId === organiser.id);
      expect(receipt).toMatchObject({ emailedAt: null, payload: { audience: "organiser" } });
      expect(
        notificationSummary({ kind: receipt?.kind, payload: receipt?.payload } as never)
      ).toContain("Event request submitted");

      // Every Lead hears, seeded accounts included. Each Lead notice names the Lead audience.
      const leadIds = (
        await database
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.role, "event_coordinator_lead"))
      ).map(row => row.id);
      expect(leadIds).toContain(lead.id);
      expect(
        queued
          .filter(row => row.recipientId !== organiser.id)
          .map(row => row.recipientId)
          .toSorted()
      ).toEqual(leadIds.toSorted());
      for (const row of queued.filter(item => item.recipientId !== organiser.id)) {
        expect(row).toMatchObject({ emailedAt: null, payload: { audience: "lead" } });
      }
      const leadNotice = queued.find(row => row.recipientId === lead.id);
      expect(
        notificationSummary({ kind: leadNotice?.kind, payload: leadNotice?.payload } as never)
      ).toContain("New event request awaiting a Coordinator");
    });
  });

  it("keeps the events when a Coordinator's account is deleted, vacating the assignment", async () => {
    const gone = {
      id: "test-coordinator-gone",
      name: "Leaving Coordinator",
      email: "coordinator.gone@example.com",
      emailVerified: true,
      role: "event_coordinator",
      createdAt: new Date("1999-01-01T00:00:00Z"),
    };
    await database.insert(schema.user).values(gone);
    const submitted = await submitNew(fullRequest, organiser, database);
    // PTR-144: the submission waits unassigned. The queue assigns the row in SQL.
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: gone.id, assignedAt: new Date() })
      .where(eq(schema.eventRequests.id, submitted.id));

    await database.delete(schema.user).where(eq(schema.user.id, gone.id));

    const read = await handleGetEventRequest({ id: submitted.id }, organiser, database as never);
    expect(read?.status).toBe("submitted");
    expect(read?.coordinator).toBeNull();
    expect(read?.assignedAt).toBeInstanceOf(Date);
    expect((await handleListUnassignedEventRequests(database as never)).map(r => r.id)).toEqual([
      submitted.id,
    ]);
  });

  it("never gives a draft a Coordinator (PTR-9 AC4)", async () => {
    const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);

    expect(draft.assignedCoordinatorId).toBeNull();
    expect(draft.assignedAt).toBeNull();
    await expect(
      database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: "test-coordinator-a", assignedAt: new Date() })
        .where(eq(schema.eventRequests.id, draft.id))
    ).rejects.toMatchObject({ cause: { constraint: "event_requests_draft_has_no_coordinator" } });
  });

  it("returns the Coordinator's name and email with the organiser's reads once assigned", async () => {
    const submitted = await submitNew(fullRequest, organiser, database);
    // PTR-144: the submission waits unassigned. The queue assigns the row in SQL.
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: "test-coordinator-a", assignedAt: new Date() })
      .where(eq(schema.eventRequests.id, submitted.id));

    const listed = await handleListEventRequests(organiser, database as never);
    expect(listed[0].coordinator).toEqual({
      name: "Coordinator A",
      email: "coordinator.a@example.com",
    });

    const read = await handleGetEventRequest({ id: submitted.id }, organiser, database as never);
    expect(read?.coordinator).toEqual({
      name: "Coordinator A",
      email: "coordinator.a@example.com",
    });

    const draft = await handleSaveEventRequestDraft(
      { eventName: "Draft" },
      organiser,
      database as never
    );
    const readDraft = await handleGetEventRequest({ id: draft.id }, organiser, database as never);
    expect(readDraft?.coordinator).toBeNull();
  });

  it("lists only submitted, unassigned requests, oldest wait first", async () => {
    await handleSaveEventRequestDraft({ eventName: "A draft" }, organiser, database as never);

    // An assigned request never reaches the queue.
    await assignedRequest(extraCoordinators[0].id);

    // Two unassigned submissions with known wait order.
    const [older, newer] = await Promise.all([
      handleSaveEventRequestDraft(
        { ...fullRequest, eventName: "Older wait" },
        organiser,
        database as never
      ),
      handleSaveEventRequestDraft(
        { ...fullRequest, eventName: "Newer wait" },
        organiser,
        database as never
      ),
    ]);

    await database
      .update(schema.eventRequests)
      .set({
        status: "submitted",
        submittedAt: new Date("2026-09-10T00:00:00Z"),
      })
      .where(eq(schema.eventRequests.id, older.id));

    await database
      .update(schema.eventRequests)
      .set({
        status: "submitted",
        submittedAt: new Date("2026-09-11T00:00:00Z"),
      })
      .where(eq(schema.eventRequests.id, newer.id));

    const unassigned = await handleListUnassignedEventRequests(database as never);

    expect(unassigned.map(row => row.eventName)).toEqual(["Older wait", "Newer wait"]);
  });
});

describe("Status set and decision attribution (PTR-21)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  const decided = {
    decidedByCoordinatorId: "seed-coordinator-1",
    decidedByCoordinatorName: "Seeded Event Coordinator",
    decidedAt: new Date(),
  };

  // PTR-24: a confirmed event records who confirmed it and when. The decision CHECK is the
  // only CHECK these writes can trip.
  const confirmed = {
    confirmedById: "seed-coordinator-1",
    confirmedByName: "Seeded Event Coordinator",
    confirmedAt: new Date(),
  };
  const completed = {
    completedById: "seed-coordinator-1",
    completedByName: "Seeded Event Coordinator",
    completedAt: new Date(),
  };

  async function submitted() {
    const saved = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
    return handleSubmitEventRequest({ id: saved.id }, organiser, database as never);
  }

  it.each(["planning", "confirmed", "completed"] as const)(
    "keeps the decision attribution through %s (AC1)",
    async status => {
      const request = await submitted();

      await expect(
        database
          .update(schema.eventRequests)
          .set({
            status,
            ...(status === "confirmed" ? confirmed : {}),
            ...(status === "completed" ? completed : {}),
          })
          .where(eq(schema.eventRequests.id, request.id))
      ).rejects.toMatchObject({ cause: { constraint: "event_requests_decision_matches_status" } });

      const [row] = await database
        .update(schema.eventRequests)
        .set({
          status,
          ...decided,
          ...(status === "confirmed" ? confirmed : {}),
          ...(status === "completed" ? completed : {}),
        })
        .where(eq(schema.eventRequests.id, request.id))
        .returning();
      expect(row.status).toBe(status);
    }
  );

  it("lets a request be cancelled before or after a decision, never half-attributed", async () => {
    // PTR-54 AC1: a cancellation always carries who and when.
    const cancellation = {
      cancelledById: "seed-coordinator-1",
      cancelledByName: "Event List Coordinator",
      cancelledAt: new Date(),
    };
    const before = await submitted();
    const [cancelledBefore] = await database
      .update(schema.eventRequests)
      .set({ status: "cancelled", ...cancellation })
      .where(eq(schema.eventRequests.id, before.id))
      .returning();
    expect(cancelledBefore.status).toBe("cancelled");

    const after = await submitted();
    const [cancelledAfter] = await database
      .update(schema.eventRequests)
      .set({ status: "cancelled", ...decided, ...cancellation })
      .where(eq(schema.eventRequests.id, after.id))
      .returning();
    expect(cancelledAfter.decidedByCoordinatorId).toBe("seed-coordinator-1");

    // A timestamp with no decider on the never-decided row fails the CHECK.
    await expect(
      database
        .update(schema.eventRequests)
        .set({ status: "cancelled", decidedAt: new Date() })
        .where(eq(schema.eventRequests.id, before.id))
    ).rejects.toMatchObject({ cause: { constraint: "event_requests_decision_matches_status" } });

    // A cancelled event needs who and when. Another stage takes no cancellation record.
    await expect(
      database
        .update(schema.eventRequests)
        .set({ cancelledById: null, cancelledByName: null, cancelledAt: null })
        .where(eq(schema.eventRequests.id, before.id))
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_cancellation_matches_status" },
    });
    const live = await submitted();
    await expect(
      database
        .update(schema.eventRequests)
        .set(cancellation)
        .where(eq(schema.eventRequests.id, live.id))
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_cancellation_matches_status" },
    });
  });

  it("does not move the status when a venue arrangement changes (AC3)", async () => {
    const request = await submitted();
    // Cover the only arrangement writes that exist: the venue record and a venue block, each
    // through its real write path, which catches application-level coupling. Equipment
    // arrangements have no writer. Add that writer here when it lands.
    const [hall] = await database
      .select()
      .from(schema.venues)
      .where(eq(schema.venues.name, "Harbour Hall"));
    let blockId: number | undefined;
    try {
      await handleSaveVenue(
        { ...hall, maxCapacity: 999 },
        database as never,
        "venue-record-test-staff"
      );
      // A day past every seed horizon, so the block never overlaps a seed block or booking.
      const block = await handleRecordVenueBlock(
        {
          venueId: hall.id,
          date: "2099-01-01",
          startTime: "09:00",
          endDate: "2099-01-01",
          endTime: "12:00",
          reason: "PTR-21 AC3",
        },
        seedVenueStaff,
        database as never
      );
      blockId = block.id;

      const [row] = await database
        .select({ status: schema.eventRequests.status })
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, request.id));
      expect(row.status).toBe("submitted");
    } finally {
      // The seed rows are shared. Restore the venue and lift the block, even on failure.
      await handleSaveVenue(hall, database as never, "venue-record-test-staff");
      if (blockId !== undefined) {
        await handleLiftVenueBlock({ id: blockId }, seedVenueStaff, database as never);
      }
    }
  });
});
