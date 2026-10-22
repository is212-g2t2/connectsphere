// oxlint-disable node/no-process-env
import { and, asc, eq } from "drizzle-orm";
import { S3Client } from "bun";

import type { db as Db } from "#/db";
import { eventRequestAttachments, eventRequests } from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import {
  ATTACHMENT_LIMIT_MESSAGE,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_NOT_DRAFT_MESSAGE,
  ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
  attachmentExtensionFor,
  detectAttachmentContentType,
  parseAttachmentDownload,
  sanitizeAttachmentFilename,
} from "#/features/event-requests/attachments";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { env } from "#/env";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only. Its value imports of `#/db/schema` and `bun` build tables and
 * the object client at module scope. `server-fns.ts` and the smoke route import it dynamically
 * inside their handlers.
 *
 * Middleware verifies the session and `event_request:create` before this runs. `user` is the
 * verified organiser. Follow-ups reuse this seam: PTR-159 removes objects beside rows, and
 * PTR-160 reads them for the Coordinator.
 */

type Database = typeof Db;
type EventRequestAttachment = typeof eventRequestAttachments.$inferSelect;
type EventRequestAttachmentSummary = Pick<
  EventRequestAttachment,
  "id" | "eventRequestId" | "originalFilename" | "contentType" | "sizeBytes" | "createdAt"
>;

const log = logger.getChild("event-request-attachments");

/** The object store behind attachment rows. Bytes in, bytes out; the handlers own every check. */
export interface AttachmentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

/**
 * In-memory store for integration tests. Refuses to start on Cloud Run, so a test double can
 * never serve production traffic.
 */
export class MemoryAttachmentStorage implements AttachmentStorage {
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  constructor() {
    if (process.env.K_SERVICE ?? process.env.K_REVISION) {
      throw new Error("The in-memory attachment store must not run on Cloud Run.");
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: bytes.slice(), contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes.slice() ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Test hook: the keys this store still holds. */
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/** Bun's built-in S3 client against the private bucket (Cloudflare R2 in deployed
 * environments, MinIO locally). Keys are server-generated; callers never choose them. */
export class S3AttachmentStorage implements AttachmentStorage {
  constructor(private readonly client: S3Client) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.write(key, bytes, { type: contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.client.file(key);
    if (!(await file.exists())) return null;
    return new Uint8Array(await file.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    await this.client.file(key).delete();
  }
}

/**
 * Whether every value the store needs is present. A partial set reports attaching as
 * unavailable instead of failing at the first request with a raw S3 error.
 */
export function isAttachmentStorageConfigured(): boolean {
  return Boolean(
    env.STORAGE_BUCKET &&
    env.STORAGE_ENDPOINT &&
    env.STORAGE_ACCESS_KEY_ID &&
    env.STORAGE_SECRET_ACCESS_KEY
  );
}

/**
 * The configured store, or `null` when storage is not configured. Callers answer with
 * `ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE` and keep the rest of the page working. Cloudflare R2
 * answers the S3 API at the account's endpoint; a set `STORAGE_ENDPOINT` points at MinIO in local
 * development.
 */
export function getAttachmentStorage(): AttachmentStorage | null {
  const {
    STORAGE_BUCKET: bucket,
    STORAGE_ENDPOINT: endpoint,
    STORAGE_ACCESS_KEY_ID: accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3AttachmentStorage(
    new S3Client({
      bucket,
      endpoint,
      region: env.STORAGE_REGION ?? "auto",
      accessKeyId,
      secretAccessKey,
    })
  );
}

/**
 * Write one object, then round-trip it back. The release pipeline calls `/api/smoke`, which
 * runs this against the real bucket, so a deploy fails while the bucket is unreachable.
 */
export async function runAttachmentSmokeCheck(storage: AttachmentStorage): Promise<void> {
  const key = `smoke/${crypto.randomUUID()}.txt`;
  const sent = new TextEncoder().encode("connectsphere storage smoke check");
  await storage.put(key, sent, "text/plain");
  try {
    const read = await storage.get(key);
    if (!read || Buffer.compare(Buffer.from(read), Buffer.from(sent)) !== 0) {
      throw new Error("Attachment smoke check read back unexpected bytes.");
    }
  } finally {
    await storage.remove(key);
  }
}

/**
 * Delete stored objects after their rows commit. A failed object delete is logged and never
 * fails the user action. Objects left behind by a failed delete stay in the bucket; no sweep
 * removes them.
 */
export async function removeAttachmentObjects(
  storage: AttachmentStorage | null,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return;
  if (!storage) {
    log.warn("Attachment object cleanup skipped: storage is not configured", {
      count: keys.length,
    });
    return;
  }
  await Promise.all(
    keys.map(key =>
      storage
        .remove(key)
        .catch(removeError => log.warn("Attachment object cleanup failed", { key, removeError }))
    )
  );
}

/**
 * AC1: store the file under a server-generated key, then in one short transaction lock the
 * event row, check the request is still this organiser's draft with fewer than
 * `ATTACHMENT_MAX_COUNT` attachments, and insert the row. Any failed check deletes the object
 * (best effort, logged) and refuses with the reason named. Size and byte checks run before the
 * write, so they need no cleanup.
 */
export async function handleUploadEventRequestAttachment(
  input: { eventRequestId: number; filename: string; bytes: Uint8Array },
  user: SessionUser,
  database: Database,
  storage: AttachmentStorage | null
): Promise<EventRequestAttachmentSummary> {
  if (!storage) throw new Error(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE);
  if (input.bytes.length > ATTACHMENT_MAX_BYTES) throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  const contentType = detectAttachmentContentType(input.bytes);
  if (!contentType) throw new Error(ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE);

  const key = `event-requests/${input.eventRequestId}/${crypto.randomUUID()}.${attachmentExtensionFor(contentType)}`;
  try {
    await storage.put(key, input.bytes, contentType);
  } catch (putError) {
    log.warn("Attachment object write failed", { key, putError });
    throw new Error(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE, { cause: putError });
  }

  try {
    return await database.transaction(async tx => {
      const ownRows = await tx
        .select()
        .from(eventRequests)
        .where(
          and(eq(eventRequests.id, input.eventRequestId), eq(eventRequests.organiserId, user.id))
        )
        .for("update");

      const draft = ownRows.at(0);
      if (!draft) throw new AuthorizationError("Forbidden");
      if (draft.status !== "draft") throw new ConflictError(ATTACHMENT_NOT_DRAFT_MESSAGE);

      const existing = await tx
        .select({ id: eventRequestAttachments.id })
        .from(eventRequestAttachments)
        .where(eq(eventRequestAttachments.eventRequestId, input.eventRequestId));
      if (existing.length >= ATTACHMENT_MAX_COUNT) {
        throw new ConflictError(ATTACHMENT_LIMIT_MESSAGE);
      }

      const [row] = await tx
        .insert(eventRequestAttachments)
        .values({
          eventRequestId: input.eventRequestId,
          objectKey: key,
          originalFilename: sanitizeAttachmentFilename(input.filename),
          contentType,
          sizeBytes: input.bytes.length,
          uploadedById: user.id,
        })
        .returning({
          id: eventRequestAttachments.id,
          eventRequestId: eventRequestAttachments.eventRequestId,
          originalFilename: eventRequestAttachments.originalFilename,
          contentType: eventRequestAttachments.contentType,
          sizeBytes: eventRequestAttachments.sizeBytes,
          createdAt: eventRequestAttachments.createdAt,
        });
      return row;
    });
  } catch (error) {
    await removeAttachmentObjects(storage, [key]);
    throw error;
  }
}

/**
 * PTR-159: remove one of the organiser's attachments from a draft. Lock the event row first,
 * in the same order as upload, submit, and draft delete, so those paths serialise. The row delete
 * commits before the object delete, which is best effort and logged. Another organiser's
 * attachment reads as gone, and a submitted request's attachment is refused, so the review flow
 * keeps what it received.
 */
export async function handleRemoveEventRequestAttachment(
  data: unknown,
  user: SessionUser,
  database: Database,
  storage: AttachmentStorage | null
): Promise<void> {
  const { id, attachmentId } = parseAttachmentDownload(data);

  const row = await database.transaction(async tx => {
    const ownRows = await tx
      .select({ status: eventRequests.status })
      .from(eventRequests)
      .where(and(eq(eventRequests.id, id), eq(eventRequests.organiserId, user.id)))
      .for("update");
    const own = ownRows.at(0);
    if (!own) throw new NotFoundError("This attachment is no longer available.");
    if (own.status !== "draft") throw new ConflictError(ATTACHMENT_NOT_DRAFT_MESSAGE);

    const rows = await tx
      .select({ objectKey: eventRequestAttachments.objectKey })
      .from(eventRequestAttachments)
      .where(
        and(
          eq(eventRequestAttachments.id, attachmentId),
          eq(eventRequestAttachments.eventRequestId, id)
        )
      );
    const found = rows.at(0);
    if (!found) throw new NotFoundError("This attachment is no longer available.");

    await tx
      .delete(eventRequestAttachments)
      .where(
        and(
          eq(eventRequestAttachments.id, attachmentId),
          eq(eventRequestAttachments.eventRequestId, id)
        )
      );

    return found;
  });

  await removeAttachmentObjects(storage, [row.objectKey]);
}

/**
 * AC3: list this organiser's attachments for one request, oldest first. Metadata only, so this
 * works while storage is unconfigured. Another organiser's rows read as absent. The result also
 * carries whether attaching is available, so the draft page shows the AC4 notice on open.
 */
export async function handleListEventRequestAttachments(
  data: unknown,
  user: SessionUser,
  database: Database
) {
  const { id } = parseEventRequestId(data);
  const rows = await database
    .select({
      id: eventRequestAttachments.id,
      originalFilename: eventRequestAttachments.originalFilename,
      contentType: eventRequestAttachments.contentType,
      sizeBytes: eventRequestAttachments.sizeBytes,
      createdAt: eventRequestAttachments.createdAt,
    })
    .from(eventRequestAttachments)
    .innerJoin(eventRequests, eq(eventRequests.id, eventRequestAttachments.eventRequestId))
    .where(
      and(eq(eventRequestAttachments.eventRequestId, id), eq(eventRequests.organiserId, user.id))
    )
    .orderBy(asc(eventRequestAttachments.id));

  return { attachments: rows, storageAvailable: isAttachmentStorageConfigured() };
}

/**
 * AC3: download one of the organiser's attachments through the server. Returns the stored
 * content type (byte-identified at upload) and the bytes as base64, which serializes across
 * the server-function boundary. A missing row or object reads as gone.
 */
export async function handleDownloadEventRequestAttachment(
  data: unknown,
  user: SessionUser,
  database: Database,
  storage: AttachmentStorage | null
) {
  const { id, attachmentId } = parseAttachmentDownload(data);
  if (!storage) throw new Error(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE);

  const rows = await database
    .select({
      originalFilename: eventRequestAttachments.originalFilename,
      contentType: eventRequestAttachments.contentType,
      sizeBytes: eventRequestAttachments.sizeBytes,
      objectKey: eventRequestAttachments.objectKey,
    })
    .from(eventRequestAttachments)
    .innerJoin(eventRequests, eq(eventRequests.id, eventRequestAttachments.eventRequestId))
    .where(
      and(
        eq(eventRequestAttachments.id, attachmentId),
        eq(eventRequestAttachments.eventRequestId, id),
        eq(eventRequests.organiserId, user.id)
      )
    );
  const row = rows.at(0);
  if (!row) throw new NotFoundError("This attachment is no longer available.");

  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(row.objectKey);
  } catch (getError) {
    log.warn("Attachment object read failed", { key: row.objectKey, getError });
    throw new Error(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE, { cause: getError });
  }
  if (!bytes) throw new NotFoundError("This attachment is no longer available.");

  return {
    filename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    base64: Buffer.from(bytes).toString("base64"),
  };
}
