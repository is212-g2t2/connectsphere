// These mutations share fixtures and mail capture; their assertions must run in sequence.
// oxlint-disable node/no-process-env, no-await-in-loop
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ReactElement } from "react";
import * as schema from "#/db/schema";
import { handleGetEventRequest } from "#/features/event-requests/drafts.server";
import {
  handleGetCoordinationRequest,
  handleRaiseClarificationRequest,
} from "#/features/coordination/assignments.server";
import { handleReplyToClarification } from "#/features/event-requests/replies.server";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(to: string, subject: string, react: ReactElement) => Promise<unknown>>()
    .mockResolvedValue({ id: "mail" }),
}));
vi.mock("#/lib/mailer.server", () => ({ sendEmail }));

const organiser = {
  id: "ptr19-organiser",
  name: "Reply Organiser",
  email: "ptr19-org@example.com",
  role: "event_organiser",
};
const otherOrganiser = {
  id: "ptr19-other",
  name: "Other Organiser",
  email: "ptr19-other@example.com",
  role: "event_organiser",
};
const coordinator = {
  id: "ptr19-coordinator",
  name: "Reply Coordinator",
  email: "ptr19-coord@example.com",
  role: "event_coordinator",
};
const replacement = {
  id: "ptr19-replacement",
  name: "Replacement Coordinator",
  email: "ptr19-replacement@example.com",
  role: "event_coordinator",
};
const users = [organiser, otherOrganiser, coordinator, replacement];
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  await database.insert(schema.user).values(users);
});
beforeEach(async () => {
  await database
    .delete(schema.eventRequests)
    .where(inArray(schema.eventRequests.organiserId, [organiser.id, otherOrganiser.id]));
  sendEmail.mockReset().mockResolvedValue({ id: "mail" });
});
afterAll(async () => {
  await database.delete(schema.user).where(
    inArray(
      schema.user.id,
      users.map(user => user.id)
    )
  );
  await pool.end();
});

async function question(permittedFields: string[] = []) {
  const [request] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: organiser.id,
      assignedCoordinatorId: coordinator.id,
      assignedAt: new Date("2026-09-22T01:00:00Z"),
      submittedAt: new Date("2026-09-22T00:00:00Z"),
      status: "under_review",
      eventName: "PTR19 Test Event",
      purpose: "Community workshop",
      expectedAttendance: 100,
      roomLayoutPreference: "Theatre",
      proposedDates: [{ start: "2026-10-23T09:00", end: "2026-10-23T17:00" }],
    })
    .returning();
  const clarification = await handleRaiseClarificationRequest(
    { id: request.id, body: "Please confirm attendance and layout.", permittedFields },
    coordinator,
    database as never
  );
  sendEmail.mockClear();
  return {
    request,
    clarification,
    input: {
      id: request.id,
      clarificationId: clarification.id,
      body: "Confirmed: 100 guests in Theatre.",
    },
  };
}

describe("Organiser clarification replies", () => {
  it("refuses an unassigned event without saving, and allows retry once a Coordinator is assigned", async () => {
    const { request, input } = await question();
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: null })
      .where(eq(schema.eventRequests.id, request.id));
    await expect(
      handleReplyToClarification(input, organiser, database as never)
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Coordinator") });
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "awaiting_organiser",
      clarifications: [expect.objectContaining({ replyBody: null })],
    });
    expect(sendEmail).not.toHaveBeenCalled();
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: replacement.id })
      .where(eq(schema.eventRequests.id, request.id));
    expect(
      (await handleReplyToClarification(input, organiser, database as never)).notification
    ).toBe("sent");
  });
  it("preserves the committed reply when mail fails and reports delivery failure", async () => {
    const { request, input } = await question(["expectedAttendance"]);
    sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    const result = await handleReplyToClarification(
      { ...input, amendments: { expectedAttendance: 120 } },
      organiser,
      database as never
    );
    expect(result.notification).toBe("failed");
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      expectedAttendance: 120,
      clarifications: [expect.objectContaining({ replyBody: input.body })],
    });
  });
  it("notifies the current Coordinator after reassignment and keeps the original question author", async () => {
    const { request, input } = await question();
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: replacement.id })
      .where(eq(schema.eventRequests.id, request.id));
    const result = await handleReplyToClarification(input, organiser, database as never);
    expect(result).toMatchObject({
      notification: "sent",
      clarification: { coordinatorId: coordinator.id },
    });
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(
      replacement.email,
      "Clarification replied: PTR19 Test Event",
      expect.objectContaining({
        props: expect.objectContaining({
          eventName: "PTR19 Test Event",
          question: "Please confirm attendance and layout.",
          body: input.body,
          eventRequestUrl: `http://localhost:3000/coordination/${request.id}`,
        }),
      })
    );
  });
  it("saves only the concerned fields with the reply and preserves all other request values", async () => {
    const { request, input } = await question(["expectedAttendance", "roomLayoutPreference"]);
    await handleReplyToClarification(
      { ...input, amendments: { expectedAttendance: 120, roomLayoutPreference: "Classroom" } },
      organiser,
      database as never
    );
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      expectedAttendance: 120,
      roomLayoutPreference: "Classroom",
      purpose: "Community workshop",
      clarifications: [
        expect.objectContaining({
          permittedFields: ["expectedAttendance", "roomLayoutPreference"],
          replyBody: input.body,
        }),
      ],
    });
  });
  it("records only the fields whose value actually changed, grouping attendee registration", async () => {
    const { request, input } = await question([
      "expectedAttendance",
      "roomLayoutPreference",
      "attendeeRegistration",
    ]);
    await handleReplyToClarification(
      {
        ...input,
        amendments: {
          expectedAttendance: 120,
          // Identical to the fixture: permitted, but not an amendment.
          roomLayoutPreference: "Theatre",
          registrationEnabled: true,
          registrationCapacity: 50,
          registrationOpensAt: "2026-10-01T09:00",
          registrationClosesAt: "2026-10-20T17:00",
        },
      },
      organiser,
      database as never
    );
    const read = await handleGetEventRequest({ id: request.id }, organiser, database as never);
    expect(read?.clarifications[0].amendments).toEqual([
      { field: "expectedAttendance", from: 100, to: 120 },
      {
        field: "attendeeRegistration",
        from: {
          registrationEnabled: false,
          registrationCapacity: null,
          registrationOpensAt: null,
          registrationClosesAt: null,
        },
        to: {
          registrationEnabled: true,
          registrationCapacity: 50,
          registrationOpensAt: "2026-10-01T09:00",
          registrationClosesAt: "2026-10-20T17:00",
        },
      },
    ]);
  });
  it("records no amendment when a permitted attendee registration question leaves it off and unchanged", async () => {
    const { request, input } = await question(["attendeeRegistration"]);
    await handleReplyToClarification(input, organiser, database as never);
    const read = await handleGetEventRequest({ id: request.id }, organiser, database as never);
    expect(read?.clarifications[0].amendments).toEqual([]);
  });
  it("keeps an earlier reply's amendment when a later reply to the same field omits it", async () => {
    const { request, clarification, input } = await question(["expectedAttendance"]);
    const second = await handleRaiseClarificationRequest(
      {
        id: request.id,
        body: "Confirm the attendance again.",
        permittedFields: ["expectedAttendance"],
      },
      coordinator,
      database as never
    );
    sendEmail.mockClear();
    await handleReplyToClarification(
      { ...input, amendments: { expectedAttendance: 120 } },
      organiser,
      database as never
    );
    await handleReplyToClarification(
      { id: request.id, clarificationId: second.id, body: "No further change." },
      organiser,
      database as never
    );
    const read = await handleGetEventRequest({ id: request.id }, organiser, database as never);
    expect(read).toMatchObject({ status: "under_review", expectedAttendance: 120 });
    expect(read?.clarifications.map(row => row.id)).toEqual([clarification.id, second.id]);
    expect(read?.clarifications.map(row => row.amendments)).toEqual([
      [{ field: "expectedAttendance", from: 100, to: 120 }],
      [],
    ]);
  });
  it("saves an explanation, returns the event to review, and shows the paired history to both parties", async () => {
    const { request, clarification, input } = await question();
    await handleReplyToClarification(input, organiser, database as never);
    const expected = {
      status: "under_review",
      expectedAttendance: 100,
      roomLayoutPreference: "Theatre",
      submittedAt: request.submittedAt,
      assignedAt: request.assignedAt,
      assignedCoordinatorId: coordinator.id,
      clarifications: [
        expect.objectContaining({
          id: clarification.id,
          body: clarification.body,
          replyBody: input.body,
          repliedByOrganiserId: organiser.id,
          repliedAt: expect.any(Date),
        }),
      ],
    };
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject(expected);
    expect(
      await handleGetCoordinationRequest({ id: request.id }, coordinator, database as never)
    ).toMatchObject(expected);
  });

  it("refuses another organiser and mismatched question ids without exposing or changing either request", async () => {
    const own = await question();
    const [otherRequest] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: otherOrganiser.id,
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date("2026-09-22T01:00:00Z"),
        submittedAt: new Date("2026-09-22T00:00:00Z"),
        status: "under_review",
        eventName: "Other PTR19 Event",
        purpose: "Private workshop",
        expectedAttendance: 40,
        roomLayoutPreference: "Boardroom",
        proposedDates: [{ start: "2026-10-24T09:00", end: "2026-10-24T17:00" }],
      })
      .returning();
    const otherClarification = await handleRaiseClarificationRequest(
      {
        id: otherRequest.id,
        body: "Confirm the room.",
        permittedFields: [],
      },
      coordinator,
      database as never
    );
    sendEmail.mockClear();

    await expect(
      handleReplyToClarification(own.input, otherOrganiser, database as never)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleReplyToClarification(
        { ...own.input, clarificationId: otherClarification.id },
        organiser,
        database as never
      )
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleReplyToClarification({ ...own.input, id: 2_147_483_647 }, organiser, database as never)
    ).rejects.toMatchObject({ status: 403 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      await handleGetEventRequest({ id: own.request.id }, organiser, database as never)
    ).toMatchObject({
      status: "awaiting_organiser",
      clarifications: [expect.objectContaining({ replyBody: null })],
    });
    expect(
      await handleGetEventRequest({ id: otherRequest.id }, otherOrganiser, database as never)
    ).toMatchObject({
      status: "awaiting_organiser",
      clarifications: [expect.objectContaining({ replyBody: null })],
    });
  });

  it.each(["approved", "rejected", "submitted", "draft"] as const)(
    "refuses a reply when the request status is %s",
    async status => {
      const { request, input } = await question();
      await database
        .update(schema.eventRequests)
        .set(
          status === "draft"
            ? { status, assignedCoordinatorId: null, assignedAt: null, submittedAt: null }
            : status === "approved" || status === "rejected"
              ? {
                  status,
                  decisionReason: status === "rejected" ? "Test rejection" : null,
                  decidedByCoordinatorId: coordinator.id,
                  decidedByCoordinatorName: coordinator.name,
                  decidedAt: new Date("2026-09-23T00:00:00Z"),
                }
              : { status }
        )
        .where(eq(schema.eventRequests.id, request.id));
      await expect(
        handleReplyToClarification(input, organiser, database as never)
      ).rejects.toMatchObject({ status: 409 });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({ status, clarifications: [expect.objectContaining({ replyBody: null })] });
    }
  );

  it("rejects unscoped and unknown amendments as one unchanged mutation", async () => {
    for (const amendments of [{ purpose: "forged" }, { unknownField: "forged" }]) {
      const { request, input } = await question(["expectedAttendance"]);
      await expect(
        handleReplyToClarification({ ...input, amendments }, organiser, database as never)
      ).rejects.toMatchObject({ status: 403 });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({
        status: "awaiting_organiser",
        expectedAttendance: 100,
        purpose: "Community workshop",
        clarifications: [expect.objectContaining({ replyBody: null })],
      });
    }
  });

  it("rejects invalid merged request values before saving the reply", async () => {
    const invalidCases = [
      {
        permittedFields: ["expectedAttendance"],
        amendments: { expectedAttendance: 0 },
        message: "Expected attendance must be a positive whole number",
      },
      {
        permittedFields: ["expectedAttendance"],
        amendments: { expectedAttendance: 1.5 },
        message: "Expected attendance must be a positive whole number",
      },
      {
        permittedFields: ["expectedAttendance"],
        amendments: { expectedAttendance: 2_147_483_648 },
        message: "Expected attendance must be 2147483647 or fewer",
      },
      {
        permittedFields: ["eventName"],
        amendments: { eventName: "   " },
        message: "This request is missing: Event name",
      },
      {
        permittedFields: ["proposedDates"],
        amendments: { proposedDates: [{ start: "2026-10-23T17:00", end: undefined }] },
        message: "This request is missing: Proposed dates and times",
      },
      {
        permittedFields: ["proposedDates"],
        amendments: { proposedDates: [{ start: "2026-10-23T17:00", end: "2026-10-23T09:00" }] },
        message: "The proposed end date and time must be later than the start",
      },
      {
        permittedFields: ["equipmentRequirements"],
        amendments: { equipmentRequirements: [{ type: "", quantity: 1 }] },
        message: "This request is missing: Equipment requirements",
      },
      {
        permittedFields: ["equipmentRequirements"],
        amendments: { equipmentRequirements: [{ type: "Projector", quantity: undefined }] },
        message: "This request is missing: Equipment requirements",
      },
      {
        permittedFields: ["attendeeRegistration"],
        amendments: { registrationEnabled: true },
        message: "Registration capacity is required when registration is enabled",
      },
      {
        permittedFields: ["attendeeRegistration"],
        amendments: {
          registrationEnabled: true,
          registrationCapacity: 10,
          registrationOpensAt: "2026-10-23T17:00",
          registrationClosesAt: "2026-10-23T09:00",
        },
        message: "Registration must close after it opens",
      },
    ];
    for (const { permittedFields, amendments, message } of invalidCases) {
      const { request, input } = await question(permittedFields);
      await expect(
        handleReplyToClarification({ ...input, amendments }, organiser, database as never)
      ).rejects.toThrow(message);
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({
        status: "awaiting_organiser",
        expectedAttendance: 100,
        clarifications: [expect.objectContaining({ replyBody: null })],
      });
      expect(sendEmail).not.toHaveBeenCalled();
    }
  });

  it("accepts the valid attendance boundaries through a trusted scope", async () => {
    for (const expectedAttendance of [1, 2_147_483_647]) {
      const { request, input } = await question(["expectedAttendance"]);
      await expect(
        handleReplyToClarification(
          { ...input, amendments: { expectedAttendance } },
          organiser,
          database as never
        )
      ).resolves.toMatchObject({ notification: "sent" });
      expect(
        await handleGetEventRequest({ id: request.id }, organiser, database as never)
      ).toMatchObject({ status: "under_review", expectedAttendance });
    }
  });

  it("keeps a legacy empty-scope question replyable while refusing its forged amendment", async () => {
    const { request, input } = await question();
    await expect(
      handleReplyToClarification(
        { ...input, amendments: { expectedAttendance: 120 } },
        organiser,
        database as never
      )
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleReplyToClarification(input, organiser, database as never)
    ).resolves.toMatchObject({ notification: "sent" });
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      expectedAttendance: 100,
      clarifications: [expect.objectContaining({ permittedFields: [], replyBody: input.body })],
    });
  });

  it("keeps unanswered questions independently replyable after another question is answered", async () => {
    const { request, clarification, input } = await question(["expectedAttendance"]);
    const second = await handleRaiseClarificationRequest(
      {
        id: request.id,
        body: "Confirm the room layout.",
        permittedFields: ["roomLayoutPreference"],
      },
      coordinator,
      database as never
    );
    sendEmail.mockClear();
    await handleReplyToClarification(
      { ...input, amendments: { expectedAttendance: 120 } },
      organiser,
      database as never
    );
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      expectedAttendance: 120,
      clarifications: [
        expect.objectContaining({
          id: clarification.id,
          replyBody: input.body,
          permittedFields: ["expectedAttendance"],
        }),
        expect.objectContaining({
          id: second.id,
          replyBody: null,
          permittedFields: ["roomLayoutPreference"],
        }),
      ],
    });
    await handleReplyToClarification(
      { id: request.id, clarificationId: second.id, body: "Classroom" },
      organiser,
      database as never
    );
    await expect(
      handleReplyToClarification(input, organiser, database as never)
    ).rejects.toMatchObject({ status: 409 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent duplicate replies to one save and one notification", async () => {
    const { request, input } = await question(["expectedAttendance"]);
    const results = await Promise.allSettled([
      handleReplyToClarification(
        { ...input, amendments: { expectedAttendance: 120 } },
        organiser,
        database as never
      ),
      handleReplyToClarification(
        { ...input, amendments: { expectedAttendance: 130 } },
        organiser,
        database as never
      ),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { status: 409 } });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      clarifications: [expect.objectContaining({ replyBody: input.body })],
    });
    const winner = results.findIndex(result => result.status === "fulfilled");
    expect(
      (await handleGetEventRequest({ id: request.id }, organiser, database as never))
        ?.expectedAttendance
    ).toBe([120, 130][winner]);
  });

  it("rolls back the reply and request status when the status write fails, then retries cleanly", async () => {
    const { request, input } = await question(["expectedAttendance"]);
    const replyInput = { ...input, amendments: { expectedAttendance: 120 } };
    const dropFailureGuard = async () => {
      await database.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS ptr19_clarification_reply_status_failure_trigger ON event_requests"
        )
      );
      await database.execute(
        sql.raw("DROP FUNCTION IF EXISTS ptr19_clarification_reply_status_failure_function()")
      );
    };
    await dropFailureGuard();
    await database
      .update(schema.eventRequests)
      .set({ status: "awaiting_organiser" })
      .where(eq(schema.eventRequests.id, request.id));
    await database.execute(
      sql.raw(
        "CREATE FUNCTION ptr19_clarification_reply_status_failure_function() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PTR19 status write failure'; END; $$"
      )
    );
    await database.execute(
      sql.raw(
        `CREATE TRIGGER ptr19_clarification_reply_status_failure_trigger BEFORE UPDATE OF status ON event_requests FOR EACH ROW WHEN (OLD.id = ${request.id} AND OLD.status = 'awaiting_organiser' AND NEW.status = 'under_review') EXECUTE FUNCTION ptr19_clarification_reply_status_failure_function()`
      )
    );
    try {
      await expect(
        handleReplyToClarification(replyInput, organiser, database as never)
      ).rejects.toMatchObject({ cause: { message: "PTR19 status write failure" } });
      expect(sendEmail).not.toHaveBeenCalled();
      const organiserRead = await handleGetEventRequest(
        { id: request.id },
        organiser,
        database as never
      );
      const coordinatorRead = await handleGetCoordinationRequest(
        { id: request.id },
        coordinator,
        database as never
      );
      expect(organiserRead).toMatchObject({
        status: "awaiting_organiser",
        expectedAttendance: 100,
        clarifications: [
          expect.objectContaining({ replyBody: null, repliedByOrganiserId: null, repliedAt: null }),
        ],
      });
      expect(coordinatorRead).toMatchObject({
        status: "awaiting_organiser",
        expectedAttendance: 100,
        clarifications: [
          expect.objectContaining({ replyBody: null, repliedByOrganiserId: null, repliedAt: null }),
        ],
      });
    } finally {
      await dropFailureGuard();
    }
    await expect(
      handleReplyToClarification(replyInput, organiser, database as never)
    ).resolves.toMatchObject({ notification: "sent" });
    expect(
      await handleGetEventRequest({ id: request.id }, organiser, database as never)
    ).toMatchObject({
      status: "under_review",
      expectedAttendance: 120,
      clarifications: [expect.objectContaining({ replyBody: input.body })],
    });
  });
});
