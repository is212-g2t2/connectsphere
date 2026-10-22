// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  getAttachmentStorage,
  handleDownloadEventAttachment,
  handleListEventAttachments,
  handleUploadEventRequestAttachment,
} from "#/features/event-requests/attachments.server";
import {
  ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
  EVENT_ATTACHMENT_GONE_MESSAGE,
} from "#/features/event-requests/attachments";
import {
  handleSaveEventRequestDraft,
  handleSubmitEventRequest,
} from "#/features/event-requests/drafts.server";

function actor(id: string, role: string): SessionUser {
  return { id, role, name: id, email: `${id}@example.com` };
}

const organiser = actor("test-ea-organiser", "event_organiser");
const coordinator = actor("test-ea-coordinator", "event_coordinator");
const lead = actor("test-ea-lead", "event_coordinator_lead");
const safetyOfficer = actor("test-ea-safety", "safety_officer");
const attendee = actor("test-ea-attendee", "attendee");
const venueStaff = actor("test-ea-venue", "venue_staff");
const techSupport = actor("test-ea-tech", "technical_support_staff");
const stranger = actor("test-ea-stranger", "event_organiser");

const fixtures = [
  organiser,
  coordinator,
  lead,
  safetyOfficer,
  attendee,
  venueStaff,
  techSupport,
  stranger,
].map(user => ({
  id: user.id,
  name: user.id,
  email: user.email,
  emailVerified: true,
  role: user.role as string,
}));

const organiserIds = [organiser.id];

function pdfBytes(extra = ""): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4 event${extra}`);
}

const completeDraft = {
  eventName: "Community workshop",
  purpose: "Meet neighbours",
  proposedDates: [{ start: "2026-10-12T14:30", end: "2026-10-12T18:45" }],
  expectedAttendance: 25,
};

describe("Event attachment allow-list", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;

  beforeAll(async () => {
    const fixturePool = new Pool({ connectionString: process.env.DATABASE_URL });
    await drizzle(fixturePool, { schema })
      .insert(schema.user)
      .values(fixtures)
      .onConflictDoNothing();
    await fixturePool.end();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    const [venue] = await database.select().from(schema.venues).limit(1);
    venueId = venue.id;
  });

  afterAll(async () => {
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        fixtures.map(user => user.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  /**
   * A submitted event with one attachment, an assigned Coordinator, a safety review, a venue
   * arrangement for Venue Staff, an equipment line for Technical Support, and a registration
   * for the Attendee. The refused roles therefore hold event access but read no attachments.
   */
  async function makeEvent() {
    const draft = await handleSaveEventRequestDraft(completeDraft, organiser, database as never);
    const storage = getAttachmentStorage();
    if (!storage) throw new Error("Attachment storage is not configured for integration tests.");
    const bytes = pdfBytes();
    const row = await handleUploadEventRequestAttachment(
      { eventRequestId: draft.id, filename: "floor-plan.pdf", bytes },
      organiser,
      database as never,
      storage
    );
    await handleSubmitEventRequest({ id: draft.id }, organiser, database as never);
    await database
      .update(schema.eventRequests)
      .set({ assignedCoordinatorId: coordinator.id, assignedAt: new Date() })
      .where(eq(schema.eventRequests.id, draft.id));
    await database
      .insert(schema.safetyReviews)
      .values({ eventRequestId: draft.id, fingerprint: "test-fingerprint" });
    await database.insert(schema.venueRequests).values({
      id: `test-ea-vr-${draft.id}`,
      eventId: draft.id,
      venueId,
      startsAt: "2026-10-12T14:30",
      endsAt: "2026-10-12T18:45",
      assignedStaffId: venueStaff.id,
      status: "pending",
    });
    await database.insert(schema.equipmentRequests).values({
      id: `test-ea-eq-${draft.id}`,
      eventId: draft.id,
      item: "Projector",
      quantity: 1,
      arrangementStatus: "requested",
      assignedStaffId: techSupport.id,
    });
    await database.insert(schema.eventRegistrations).values({
      eventId: draft.id,
      attendeeId: attendee.id,
      status: "registered",
    });
    return { eventId: draft.id, attachmentId: row.id, storage, bytes };
  }

  it.each([
    ["the owning organiser", organiser],
    ["the assigned coordinator", coordinator],
    ["a lead", lead],
    ["a safety officer reviewing the event", safetyOfficer],
  ])("lists and downloads for %s", async (_name, reader) => {
    const { eventId, attachmentId, storage, bytes } = await makeEvent();

    const listed = await handleListEventAttachments({ id: eventId }, reader, database as never);
    expect(listed.attachments).toHaveLength(1);
    expect(listed.attachments[0]).toMatchObject({
      id: attachmentId,
      originalFilename: "floor-plan.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
    });
    expect(listed.attachments[0]).not.toHaveProperty("objectKey");

    const downloaded = await handleDownloadEventAttachment(
      { id: eventId, attachmentId },
      reader,
      database as never,
      storage
    );
    expect(downloaded).toMatchObject({
      filename: "floor-plan.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
    });
    expect(downloaded.bytes).toEqual(bytes);
    expect(downloaded).not.toHaveProperty("objectKey");
  });

  it.each([
    ["an attendee", attendee],
    ["venue staff with an arrangement", venueStaff],
    ["technical support with an arrangement", techSupport],
    ["a stranger", stranger],
  ])("refuses %s with the same response as a missing event", async (_name, reader) => {
    const { eventId, attachmentId, storage } = await makeEvent();

    await expect(
      handleListEventAttachments({ id: eventId }, reader, database as never)
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
    await expect(
      handleDownloadEventAttachment(
        { id: eventId, attachmentId },
        reader,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });

    const missingId = 2_147_483_647;
    await expect(
      handleListEventAttachments({ id: missingId }, organiser, database as never)
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
    await expect(
      handleDownloadEventAttachment(
        { id: missingId, attachmentId },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
  });

  it("refuses a safety officer with no review on the event", async () => {
    const { eventId, attachmentId, storage } = await makeEvent();
    await database
      .delete(schema.safetyReviews)
      .where(eq(schema.safetyReviews.eventRequestId, eventId));

    await expect(
      handleListEventAttachments({ id: eventId }, safetyOfficer, database as never)
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
    await expect(
      handleDownloadEventAttachment(
        { id: eventId, attachmentId },
        safetyOfficer,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
  });

  it("lists metadata while storage is unconfigured, and names the unavailable download", async () => {
    const { eventId, attachmentId } = await makeEvent();

    const listed = await handleListEventAttachments({ id: eventId }, organiser, database as never);
    expect(listed.attachments).toHaveLength(1);

    await expect(
      handleDownloadEventAttachment(
        { id: eventId, attachmentId },
        organiser,
        database as never,
        null
      )
    ).rejects.toThrow(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE);
  });

  it("reads a deleted object as gone", async () => {
    const { eventId, attachmentId, storage } = await makeEvent();
    const [row] = await database
      .select({ objectKey: schema.eventRequestAttachments.objectKey })
      .from(schema.eventRequestAttachments)
      .where(eq(schema.eventRequestAttachments.id, attachmentId));
    await storage.remove(row.objectKey);

    await expect(
      handleDownloadEventAttachment(
        { id: eventId, attachmentId },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError", message: EVENT_ATTACHMENT_GONE_MESSAGE });
  });
});
