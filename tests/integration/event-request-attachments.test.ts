// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import type { AttachmentStorage } from "#/features/event-requests/attachments.server";
import {
  getAttachmentStorage,
  handleDownloadEventRequestAttachment,
  handleListEventRequestAttachments,
  handleUploadEventRequestAttachment,
  isAttachmentStorageConfigured,
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

/**
 * The real store from the testcontainer, wrapped to observe which keys are still live.
 * Replacing `storage.keys()` assertions with this keeps every check against the real bucket.
 */
function testStorage(): { storage: AttachmentStorage; liveKeys(this: void): string[] } {
  const real = getAttachmentStorage();
  if (!real) throw new Error("Attachment storage is not configured for integration tests.");
  const live = new Set<string>();
  const storage: AttachmentStorage = {
    async put(key, bytes, contentType) {
      await real.put(key, bytes, contentType);
      live.add(key);
    },
    get: key => real.get(key),
    async remove(key) {
      try {
        await real.remove(key);
      } finally {
        live.delete(key);
      }
    },
  };
  return { storage, liveKeys: () => [...live] };
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
    // Remove the objects first: deleting the drafts cascades the rows that name them.
    const rows = await database
      .select({ objectKey: schema.eventRequestAttachments.objectKey })
      .from(schema.eventRequestAttachments)
      .innerJoin(
        schema.eventRequests,
        eq(schema.eventRequests.id, schema.eventRequestAttachments.eventRequestId)
      )
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
    const storage = getAttachmentStorage();
    if (!storage) throw new Error("Attachment storage is not configured for integration tests.");
    await Promise.all(rows.map(row => storage.remove(row.objectKey)));
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
    const { storage } = testStorage();
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
    });
    const [stored] = await attachmentRows(draft.id);
    expect(stored.objectKey.startsWith(`event-requests/${draft.id}/`)).toBe(true);
    expect(stored.objectKey.endsWith(".pdf")).toBe(true);
    expect(stored.uploadedById).toBe(organiser.id);
    expect(await storage.get(stored.objectKey)).toEqual(bytes);
    expect(await attachmentRows(draft.id)).toHaveLength(1);
  });

  it("refuses an oversized or unidentified file before writing any object", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage, liveKeys } = testStorage();

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

    expect(liveKeys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it("deletes the written object when the request is no longer a draft", async () => {
    const draft = await draftOwnedBy(organiser, database);
    await handleSubmitEventRequest({ id: draft.id }, organiser, database as never);
    const { storage, liveKeys } = testStorage();

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "late.pdf", bytes: pdfBytes() },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "ConflictError", message: ATTACHMENT_NOT_DRAFT_MESSAGE });

    expect(liveKeys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  it("deletes the written object when the draft belongs to another organiser", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage, liveKeys } = testStorage();

    await expect(
      handleUploadEventRequestAttachment(
        { eventRequestId: draft.id, filename: "taken.pdf", bytes: pdfBytes() },
        otherOrganiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "AuthorizationError" });

    expect(liveKeys()).toEqual([]);
    expect(await attachmentRows(draft.id)).toEqual([]);
  });

  // Each upload locks the same draft row, so these uploads run in order.
  // oxlint-disable no-await-in-loop
  it("refuses the eleventh attachment and deletes its object", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage, liveKeys } = testStorage();
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

    expect(liveKeys()).toHaveLength(10);
    expect(await attachmentRows(draft.id)).toHaveLength(10);
  });
  // oxlint-enable no-await-in-loop

  it("keeps the 10-file cap when eleven uploads race", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage, liveKeys } = testStorage();

    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, index) =>
        handleUploadEventRequestAttachment(
          {
            eventRequestId: draft.id,
            filename: `race-${index}.pdf`,
            bytes: pdfBytes(`-race-${index}`),
          },
          organiser,
          database as never,
          storage
        )
      )
    );

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(10);
    expect(await attachmentRows(draft.id)).toHaveLength(10);
    expect(liveKeys()).toHaveLength(10);
  });

  it("lists the organiser's attachments oldest first, and none for another organiser", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage } = testStorage();
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
    // AC4: the list carries the configured state. The env-independent unit test covers the value.
    expect(listed.storageAvailable).toBe(isAttachmentStorageConfigured());

    const foreign = await handleListEventRequestAttachments(
      { id: draft.id },
      otherOrganiser,
      database as never
    );
    expect(foreign.attachments).toEqual([]);
  });

  it("downloads the stored bytes with the stored content type", async () => {
    const draft = await draftOwnedBy(organiser, database);
    const { storage } = testStorage();
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
  });

  it("round-trips a test object through the smoke check and leaves nothing behind", async () => {
    const { storage, liveKeys } = testStorage();
    await runAttachmentSmokeCheck(storage);
    expect(liveKeys()).toEqual([]);
  });
});
