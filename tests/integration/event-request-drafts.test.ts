// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleAssignEventRequest,
  handleGetCoordinationRequest,
  handleListAssignedEventRequests,
  handleListAssignmentNotifications,
  handleListCoordinators,
} from "#/features/coordination/assignments.server";
import {
  handleGetEventRequest,
  handleListEventRequests,
  handleListUnassignedEventRequests,
  handleSaveEventRequestDraft,
  handleSubmitEventRequest,
  pickLeastLoadedCoordinator,
} from "#/features/event-requests/drafts.server";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import {
  ALREADY_SUBMITTED_MESSAGE,
  ATTENDANCE_MESSAGE,
  END_BEFORE_START_MESSAGE,
  EQUIPMENT_QUANTITY_MESSAGE,
  REGISTRATION_CAPACITY_MESSAGE,
  REGISTRATION_CAPACITY_REQUIRED_MESSAGE,
  REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE,
  REGISTRATION_CLOSES_REQUIRED_MESSAGE,
  REGISTRATION_OPENS_REQUIRED_MESSAGE,
  SUBMITTED_EDIT_REFUSAL,
  missingFieldsMessage,
} from "#/features/event-requests/schema";

const organiser: SessionUser = {
  id: "test-user-2",
  email: "jane.doe@example.com",
  role: "event_organiser",
};
const otherOrganiser: SessionUser = {
  id: "test-user-1",
  email: "john.doe@example.com",
  role: "event_organiser",
};

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
    await database.delete(schema.eventRequests);
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
      // Stored as JSONB, so the `datetime-local` spelling survives untouched.
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

    // A partial payload against an existing id is a PUT, not a PATCH: fields it omits are
    // blanked, matching how the form always resends the complete draft.
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

    expect(await database.select().from(schema.eventRequests)).toHaveLength(0);
  });

  it("edits the same draft when its id comes back, rather than opening another", async () => {
    const created = await handleSaveEventRequestDraft(
      { eventName: "Community workshop" },
      organiser,
      database as never
    );

    const updated = await handleSaveEventRequestDraft(
      { id: created.id, eventName: "Community workshop", purpose: "Meet neighbours" },
      organiser,
      database as never
    );

    expect(updated).toMatchObject({ id: created.id, purpose: "Meet neighbours" });
    expect(await database.select().from(schema.eventRequests)).toHaveLength(1);
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

    expect(await findById(created.id)).toMatchObject({ eventName: "Private draft" });
  });

  it("refuses an id that matches no draft instead of creating one", async () => {
    await expect(
      handleSaveEventRequestDraft({ id: 987654, eventName: "Ghost" }, organiser, database as never)
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    expect(await database.select().from(schema.eventRequests)).toHaveLength(0);
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

    expect(await database.select().from(schema.eventRequests)).toHaveLength(0);
  });

  it("refuses a registration window that does not close after it opens (AC3)", async () => {
    await expect(
      handleSaveEventRequestDraft(
        { ...enabledRegistration, registrationClosesAt: enabledRegistration.registrationOpensAt },
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

  /** The invariant at the persistence layer, including the three CHECKs behind the Zod schema. */
  it("refuses registration rows the CHECK constraints forbid (PTR-11)", async () => {
    // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
    await expect(
      database
        .insert(schema.eventRequests)
        .values({ organiserId: organiser.id, registrationEnabled: true })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_terms_match_enabled" },
    });

    await expect(
      database
        .insert(schema.eventRequests)
        .values({ ...enabledRegistration, organiserId: organiser.id, registrationEnabled: false })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_registration_terms_match_enabled" },
    });

    await expect(
      database
        .insert(schema.eventRequests)
        .values({ ...enabledRegistration, organiserId: organiser.id, registrationCapacity: 0 })
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

  // No read/list endpoint exists yet (that's the rest of AC4, beyond this ticket), so this
  // asserts row ownership at the database level rather than any visibility enforcement.
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

  /**
   * PTR-13 submits the same stored row `fullRequest` already describes — every mandatory field
   * present — so each refusal below sends a draft missing exactly one thing.
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

    expect(await findById(draft.id)).toMatchObject({ status: "draft", submittedAt: null });
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

    expect(await findById(draft.id)).toMatchObject({ status: "draft", submittedAt: null });
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
    // AC5: submission keeps the row readable in place, which is the data the internal review
    // list will read; PTR-17 builds that view.
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

    expect(await database.select().from(schema.eventRequests)).toHaveLength(0);
  });

  /** The invariant at the persistence layer, behind whichever path writes the row. */
  it("refuses a submission time that disagrees with the status", async () => {
    await expect(
      database
        .insert(schema.eventRequests)
        .values({ organiserId: organiser.id, status: "submitted" })
    ).rejects.toMatchObject({
      cause: { constraint: "event_requests_submission_time_matches_status" },
    });

    await expect(
      database
        .insert(schema.eventRequests)
        .values({ organiserId: organiser.id, status: "draft", submittedAt: new Date() })
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
    await database.delete(schema.eventRequests);
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
    // Keep the comparison away from the same millisecond: Postgres timestamps are more precise
    // than the JavaScript Date used by the save path's updatedAt callback.
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

    expect(read).toEqual({ ...saved, coordinator: null });
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

/**
 * Two Coordinators beside the seeded one, created in a known order so the tie-break is testable.
 * The dates sit far in the past so both sort before the seeded account however long ago the
 * database was seeded, not only when it was seeded after the fixture dates.
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

async function submitNew(
  values: EventRequestDraftValues,
  who: SessionUser,
  database: ReturnType<typeof drizzle<typeof schema>>
) {
  const saved = await handleSaveEventRequestDraft(values, who, database as never);
  return handleSubmitEventRequest({ id: saved.id }, who, database as never);
}

describe("Assigning a Coordinator at submission (PTR-15)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    // The seeded Coordinator was created at seed time, later than these two, so it sorts last on
    // the tie-break and the two known accounts decide the rule.
    await database.insert(schema.user).values(extraCoordinators).onConflictDoNothing();
  });

  afterAll(async () => {
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        extraCoordinators.map(c => c.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await database.delete(schema.eventRequests);
  });

  describe("manual handover and pickup (PTR-16)", () => {
    const outgoing = extraCoordinators[0];
    const incoming = extraCoordinators[1];

    async function waitingRequest() {
      const saved = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
      const [waiting] = await database
        .update(schema.eventRequests)
        .set({ status: "submitted", submittedAt: new Date() })
        .where(eq(schema.eventRequests.id, saved.id))
        .returning();
      return waiting;
    }

    it("records a handover, actor and time, updates organiser reads and transfers access (AC1–3, AC5)", async () => {
      const request = await submitNew(fullRequest, organiser, database);
      const input = {
        id: request.id,
        coordinatorId: incoming.id,
        expectedCoordinatorId: outgoing.id,
        actorId: "forged",
      };
      const changed = await handleAssignEventRequest(input, outgoing, database as never);
      expect(changed.assignedCoordinatorId).toBe(incoming.id);
      expect(changed.assignedAt).toBeInstanceOf(Date);
      const [audit] = await database.select().from(schema.eventAssignments);
      expect(audit).toMatchObject({
        eventRequestId: request.id,
        actorId: outgoing.id,
        fromCoordinatorId: outgoing.id,
        toCoordinatorId: incoming.id,
        createdAt: changed.assignedAt,
      });
      await expect(
        handleGetCoordinationRequest({ id: request.id }, outgoing, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await handleGetCoordinationRequest({ id: request.id }, incoming, database as never)
      ).toMatchObject({ assignedCoordinatorId: incoming.id });
      expect(await handleListAssignedEventRequests(outgoing, database as never)).toEqual([]);
      expect(
        (await handleListAssignedEventRequests(incoming, database as never)).map(row => row.id)
      ).toEqual([request.id]);
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({ coordinator: { name: incoming.name, email: incoming.email } });
      await expect(
        handleAssignEventRequest(input, outgoing, database as never)
      ).rejects.toMatchObject({ status: 403 });
    });

    it.each([0, 1])(
      "lets any Coordinator pick up an unassigned event for themselves or a named Coordinator (%s)",
      async index => {
        const request = await waitingRequest();
        const target = extraCoordinators[index];
        await handleAssignEventRequest(
          { id: request.id, coordinatorId: target.id, expectedCoordinatorId: null },
          outgoing,
          database as never
        );
        const [audit] = await database.select().from(schema.eventAssignments);
        expect(audit).toMatchObject({
          fromCoordinatorId: null,
          toCoordinatorId: target.id,
          actorId: outgoing.id,
        });
        expect(await handleListUnassignedEventRequests(database as never)).toEqual([]);
      }
    );

    it("notifies only the Organiser and incoming Coordinator with the same recorded time (AC4)", async () => {
      const request = await submitNew(fullRequest, organiser, database);
      const changed = await handleAssignEventRequest(
        { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: outgoing.id },
        outgoing,
        database as never
      );
      const notifications = await database.select().from(schema.eventAssignmentNotifications);
      expect(notifications).toHaveLength(2);
      expect(notifications.map(row => row.recipientId).toSorted()).toEqual(
        [organiser.id, incoming.id].toSorted()
      );
      expect(
        notifications.every(row => row.createdAt.getTime() === changed.assignedAt?.getTime())
      ).toBe(true);
      expect(await handleListAssignmentNotifications(outgoing, database as never)).toEqual([]);
      expect(await handleListAssignmentNotifications(otherOrganiser, database as never)).toEqual(
        []
      );
      expect(await handleListAssignmentNotifications(organiser, database as never)).toEqual([
        expect.objectContaining({
          message: `${incoming.name} is now the Coordinator for Community workshop.`,
          eventRequestId: request.id,
        }),
      ]);
      expect(await handleListAssignmentNotifications(incoming, database as never)).toHaveLength(1);
    });

    it("refuses another Coordinator's handover, drafts, and missing requests", async () => {
      const assigned = await submitNew(fullRequest, organiser, database);
      const draft = await handleSaveEventRequestDraft(fullRequest, organiser, database as never);
      await Promise.all(
        [assigned.id, draft.id, 999_999].map(async id => {
          await expect(
            handleAssignEventRequest(
              { id, coordinatorId: incoming.id, expectedCoordinatorId: outgoing.id },
              incoming,
              database as never
            )
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            handleGetCoordinationRequest({ id }, incoming, database as never)
          ).rejects.toMatchObject({ status: 403 });
        })
      );
      expect(await database.select().from(schema.eventAssignments)).toEqual([]);
    });

    it("refuses non-Coordinators, deleted accounts, unchanged assignments, and stale observations", async () => {
      const request = await submitNew(fullRequest, organiser, database);
      await Promise.all(
        [organiser.id, "deleted-account", outgoing.id].map(async coordinatorId => {
          await expect(
            handleAssignEventRequest(
              { id: request.id, coordinatorId, expectedCoordinatorId: outgoing.id },
              outgoing,
              database as never
            )
          ).rejects.toMatchObject({ status: 409 });
        })
      );
      await expect(
        handleAssignEventRequest(
          { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: null },
          outgoing,
          database as never
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(await database.select().from(schema.eventAssignments)).toEqual([]);
      expect(await database.select().from(schema.eventAssignmentNotifications)).toEqual([]);
      expect(
        (await handleListCoordinators(database as never)).every(row => row.id !== organiser.id)
      ).toBe(true);
    });

    it("allows only one competing pickup, with one audit entry and one pair of notifications", async () => {
      const request = await waitingRequest();
      const results = await Promise.allSettled(
        extraCoordinators.map(coordinator =>
          handleAssignEventRequest(
            { id: request.id, coordinatorId: coordinator.id, expectedCoordinatorId: null },
            coordinator,
            database as never
          )
        )
      );
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      expect(await database.select().from(schema.eventAssignments)).toHaveLength(1);
      expect(await database.select().from(schema.eventAssignmentNotifications)).toHaveLength(2);
    });

    it("allows only one of two simultaneous handovers from the outgoing Coordinator", async () => {
      const request = await submitNew(fullRequest, organiser, database);
      const results = await Promise.allSettled(
        [incoming.id, "seed-coordinator-1"].map(coordinatorId =>
          handleAssignEventRequest(
            { id: request.id, coordinatorId, expectedCoordinatorId: outgoing.id },
            outgoing,
            database as never
          )
        )
      );
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(await database.select().from(schema.eventAssignments)).toHaveLength(1);
      expect(await database.select().from(schema.eventAssignmentNotifications)).toHaveLength(2);
    });

    it("rolls back the assignment and audit if notification storage fails", async () => {
      const request = await submitNew(fullRequest, organiser, database);
      // Real database transaction, with a fault injected only at notification insertion.
      const failingDatabase = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "transaction")
            return (run: (tx: unknown) => Promise<unknown>) =>
              target.transaction(tx =>
                run(
                  new Proxy(tx, {
                    get(transaction, key, transactionReceiver) {
                      if (key === "insert")
                        return (table: Parameters<typeof tx.insert>[0]) => {
                          if (table === schema.eventAssignmentNotifications)
                            throw new Error("Notification storage unavailable");
                          return tx.insert(table);
                        };
                      return Reflect.get(transaction, key, transactionReceiver);
                    },
                  })
                )
              );
          return Reflect.get(target, property, receiver);
        },
      });
      await expect(
        handleAssignEventRequest(
          { id: request.id, coordinatorId: incoming.id, expectedCoordinatorId: outgoing.id },
          outgoing,
          failingDatabase as never
        )
      ).rejects.toThrow("Notification storage unavailable");
      expect(await database.select().from(schema.eventAssignments)).toEqual([]);
      expect(await database.select().from(schema.eventAssignmentNotifications)).toEqual([]);
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({ assignedCoordinatorId: outgoing.id, assignedAt: request.assignedAt });
    });
  });

  it("assigns exactly one Coordinator, with the time, when a request is submitted (AC1, AC2)", async () => {
    const submitted = await submitNew(fullRequest, organiser, database);

    expect(submitted.assignedCoordinatorId).not.toBeNull();
    expect(submitted.assignedAt).toBeInstanceOf(Date);
    expect(submitted.assignedAt?.getTime()).toBe(submitted.submittedAt?.getTime());
  });

  it("chooses the least-loaded Coordinator, then the earliest account", async () => {
    // Nobody loaded: the earliest-created Coordinator wins the tie.
    const first = await submitNew(fullRequest, organiser, database);
    expect(first.assignedCoordinatorId).toBe("test-coordinator-a");

    // A now carries one; B is next.
    const second = await submitNew({ ...fullRequest, eventName: "Second" }, organiser, database);
    expect(second.assignedCoordinatorId).toBe("test-coordinator-b");

    // A and B carry one each; the seeded Coordinator, created last, gets the third.
    const third = await submitNew({ ...fullRequest, eventName: "Third" }, organiser, database);
    expect(third.assignedCoordinatorId).toBe("seed-coordinator-1");

    // Everyone carries one; back to the earliest account.
    const fourth = await submitNew({ ...fullRequest, eventName: "Fourth" }, organiser, database);
    expect(fourth.assignedCoordinatorId).toBe("test-coordinator-a");
  });

  it("does not count drafts as load", async () => {
    await handleSaveEventRequestDraft({ eventName: "Only a draft" }, organiser, database as never);

    expect(await pickLeastLoadedCoordinator(database as never)).toEqual({
      id: "test-coordinator-a",
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
    expect(submitted.assignedCoordinatorId).toBe(gone.id);

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

  it("returns the Coordinator's name and email with the organiser's reads (AC3)", async () => {
    const submitted = await submitNew(fullRequest, organiser, database);

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

  describe("when no Coordinator can be assigned (AC5)", () => {
    const coordinatorIds = [...extraCoordinators.map(c => c.id), "seed-coordinator-1"];

    beforeEach(async () => {
      // Demote every Coordinator for the test rather than deleting them: the seeded account has
      // a credential row and sessions hanging off it.
      await database
        .update(schema.user)
        .set({ role: "technical_support_staff" })
        .where(inArray(schema.user.id, coordinatorIds));
    });

    afterEach(async () => {
      await database
        .update(schema.user)
        .set({ role: "event_coordinator" })
        .where(inArray(schema.user.id, coordinatorIds));
    });

    it("still records the submission, unassigned, and lists it for pick-up", async () => {
      const submitted = await submitNew(fullRequest, organiser, database);

      expect(submitted.status).toBe("submitted");
      expect(submitted.assignedCoordinatorId).toBeNull();
      expect(submitted.assignedAt).toBeNull();

      const unassigned = await handleListUnassignedEventRequests(database as never);
      expect(unassigned.map(row => row.id)).toEqual([submitted.id]);
      expect(unassigned[0].organiser).toEqual({ name: "Jane Doe", email: "jane.doe@example.com" });
    });
  });

  it("lists only submitted, unassigned requests, oldest wait first", async () => {
    await handleSaveEventRequestDraft({ eventName: "A draft" }, organiser, database as never);
    const assigned = await submitNew(fullRequest, organiser, database);
    expect(assigned.assignedCoordinatorId).not.toBeNull();

    // Two rows submitted while nobody could take them, in a known order.
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
      .set({ status: "submitted", submittedAt: new Date("2026-09-10T00:00:00Z") })
      .where(eq(schema.eventRequests.id, older.id));
    await database
      .update(schema.eventRequests)
      .set({ status: "submitted", submittedAt: new Date("2026-09-11T00:00:00Z") })
      .where(eq(schema.eventRequests.id, newer.id));

    const unassigned = await handleListUnassignedEventRequests(database as never);
    expect(unassigned.map(row => row.eventName)).toEqual(["Older wait", "Newer wait"]);
  });
});
