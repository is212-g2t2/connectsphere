// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleSaveEventRequestDraft } from "#/features/event-requests/drafts.server";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import {
  ATTENDANCE_MESSAGE,
  END_BEFORE_START_MESSAGE,
  EQUIPMENT_QUANTITY_MESSAGE,
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
const attendee: SessionUser = { id: "user-demo-1", email: "demo@example.com", role: "attendee" };

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

  it("refuses a session without the organiser role", async () => {
    await expect(
      handleSaveEventRequestDraft({}, attendee, database as never)
    ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });

    await expect(handleSaveEventRequestDraft({}, null, database as never)).rejects.toMatchObject({
      name: "AuthorizationError",
      status: 401,
    });
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
});
