// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  MemoryAttachmentStorage,
  getAttachmentStorage,
  handleDownloadEventRequestAttachment,
  handleListEventRequestAttachments,
  handleUploadEventRequestAttachment,
  runAttachmentSmokeCheck,
} from "#/features/event-requests/attachments.server";
import {
  ATTACHMENT_LIMIT_MESSAGE,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NOT_DRAFT_MESSAGE,
  ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
} from "#/features/event-requests/attachments";
import {
  handleSaveEventRequestDraft,
  handleSubmitEventRequest,
} from "#/features/event-requests/drafts.server";

const organiser: SessionUser = {
  id: "test-organiser-attachments",
  email: "attachments.organiser@example.com",
  role: "event_organiser",
};
const otherOrganiser: SessionUser = {
  id: "test-organiser-attachments-other",
  email: "attachments.other@example.com",
  role: "event_organiser",
};

const organiserFixtures = [
  {
    id: organiser.id,
    name: "Attachments Organiser",
    email: organiser.email,
    emailVerified: true,
    role: "event_organiser",
  },
  {
    id: otherOrganiser.id,
    name: "Other Attachments Organiser",
    email: otherOrganiser.email,
    emailVerified: true,
    role: "event_organiser",
  },
];

const organiserIds = organiserFixtures.map(user => user.id);

function pdfBytes(extra = ""): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4 attachment${extra}`);
}

const completeDraft = {
  eventName: "Community workshop",
  purpose: "Meet neighbours",
  proposedDates: [{ start: "2026-10-12T14:30", end: "2026-10-12T18:45" }],
  expectedAttendance: 25,
};

async function draftOwnedBy(who: SessionUser, database: ReturnType<typeof drizzle<typeof schema>>) {
  return handleSaveEventRequestDraft(completeDraft, who, database as never);
}

describe("Draft attachment storage", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    const fixturePool = new Pool({ connectionString: process.env.DATABASE_URL });
    await drizzle(fixturePool, { schema })
      .insert(schema.user)
      .values(organiserFixtures)
      .onConflictDoNothing();
    await fixturePool.end();

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
  });

  afterAll(async () => {
    await database.delete(schema.user).where(inArray(schema.user.id, organiserIds));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
  });

  async function attachmentRows(eventRequestId: number) {
    return database
      .select()
      .from(schema.eventRequestAttachments)
      .where(eq(schema.eventRequestAttachments.eventRequestId, eventRequestId));
  }

  it("writes the object under a server-generated key and records the byte-identified type", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();
    const bytes = pdfBytes();

    const row = await handleUploadEventRequestAttachment(
      { eventRequestId: draft.id, filename: "../../Floor Plan.pdf", bytes },
      organiser,
      database as never,
      storage
    );

    expect(row).toMatchObject({
      eventRequestId: draft.id,
      originalFilename: "Floor Plan.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      uploadedById: organiser.id,
    });
    expect(row.objectKey.startsWith(`event-requests/${draft.id}/`)).toBe(true);
    expect(row.objectKey.endsWith(".pdf")).toBe(true);
    expect(await storage.get(row.objectKey)).toEqual(bytes);
    expect(await attachmentRows(draft.id)).toHaveLength(1);
  });

  it("refuses an oversized or unidentified file before writing any object", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();

    const tooLarge = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    tooLarge.set(pdfBytes());
    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "big.pdf", bytes: tooLarge },
        organiser,
        database as never,
        storage
      )
    ).rejects.toThrow(ATTACHMENT_TOO_LARGE_MESSAGE);

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "run.exe", bytes: new TextEncoder().encode("MZ") },
        organiser,
        database as never,
        storage
      )
    ).rejects.toThrow(ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE);

    expect(storage.keys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it("deletes the written object when the request is no longer a draft", async () => {
    const draft = await draftOwnedBy(organiser, database);
    await handleSubmitEventRequest({ id: draft.id }, organiser, database as never);
    const storage = new MemoryAttachmentStorage();

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "late.pdf", bytes: pdfBytes() },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "ConflictError", message: ATTACHMENT_NOT_DRAFT_MESSAGE });

    expect(storage.keys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it("deletes the written object when the draft belongs to another organiser", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "taken.pdf", bytes: pdfBytes() },
        otherOrganiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "AuthorizationError" });

    expect(storage.keys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  // Each upload locks the same draft row, so these uploads run in order.
  // oxlint-disable no-await-in-loop
  it("refuses the eleventh attachment and deletes its object", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();
    for (let index = 0; index < 10; index++) {
      await handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: `plan-${index}.pdf`, bytes: pdfBytes(`-${index}`) },
        organiser,
        database as never,
        storage
      );
    }

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "plan-10.pdf", bytes: pdfBytes("-10") },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "ConflictError", message: ATTACHMENT_LIMIT_MESSAGE });

    expect(storage.keys()).toHaveLength(10);
    expect(await attachmentRows(draft.id)).toHaveLength(10);
  });
  // oxlint-enable no-await-in-loop

  it("lists the organiser's attachments oldest first, and none for another organiser", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();
    const first = await handleUploadEventRequestAttachment(
      { eventRequestId: draft.id, filename: "a.pdf", bytes: pdfBytes("a") },
      organiser,
      database as never,
      storage
    );
    const second = await handleUploadEventRequestAttachment(
      { eventRequestId: draft.id, filename: "b.pdf", bytes: pdfBytes("b") },
      organiser,
      database as never,
      storage
    );

    const listed = await handleListEventRequestAttachments(
      { id: draft.id },
      organiser,
      database as never
    );
    expect(listed.attachments.map(row => row.id)).toEqual([first.id, second.id]);
    expect(listed.attachments[0]).toMatchObject({
      originalFilename: "a.pdf",
      contentType: "application/pdf",
    });
    expect(listed.storageAvailable).toBe(false);

    const foreign = await handleListEventRequestAttachments(
      { id: draft.id },
      otherOrganiser,
      database as never
    );
    expect(foreign.attachments).toEqual([]);
  });

  it("downloads the stored bytes with the stored content type", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const storage = new MemoryAttachmentStorage();
    const bytes = pdfBytes();
    const row = await handleUploadEventRequestAttachment(
      { eventRequestId: draft.id, filename: "plan.pdf", bytes },
      organiser,
      database as never,
      storage
    );

    const downloaded = await handleDownloadEventRequestAttachment(
      { id: draft.id, attachmentId: row.id },
      organiser,
      database as never,
      storage
    );

    expect(downloaded).toMatchObject({
      filename: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
    });
    expect(Buffer.from(downloaded.base64, "base64")).toEqual(Buffer.from(bytes));

    await expect(
      handleDownloadEventRequestAttachment(
        { id: draft.id, attachmentId: row.id },
        otherOrganiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("answers that storage is unavailable when no store is configured", async () => {
    const draft = await draftOwnedBy(organiser, database);

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "plan.pdf", bytes: pdfBytes() },
        organiser,
        database as never,
        null
      )
    ).rejects.toThrow(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE);

    await expect(
      handleDownloadEventRequestAttachment(
        { id: draft.id, attachmentId: 1 },
        organiser,
        database as never,
        null
      )
    ).rejects.toThrow(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE);

    expect(getAttachmentStorage()).toBeNull();
  });

  it("round-trips a test object through the smoke check and leaves nothing behind", async () => {
    const storage = new MemoryAttachmentStorage();
    await runAttachmentSmokeCheck(storage);
    expect(storage.keys()).toEqual([]);
  });

  it("refuses to start the in-memory store on Cloud Run", () => {
    vi.stubEnv("K_SERVICE", "connectsphere-staging");
    try {
      expect(() => new MemoryAttachmentStorage()).toThrow(
        "The in-memory attachment store must not run on Cloud Run."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
