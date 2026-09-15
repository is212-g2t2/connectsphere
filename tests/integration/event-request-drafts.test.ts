// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleGetEventRequest,
  handleListEventRequests,
  handleSaveEventRequestDraft,
  handleSubmitEventRequest,
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

    expect(read).toEqual(saved);
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
