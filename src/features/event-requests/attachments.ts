import { z } from "zod";

import { EventRequestIdInput } from "#/features/event-requests/schema";

/**
 * Rules for the supporting documents an Organiser attaches to a draft request. This module is
 * client-safe: the draft page reads the limits and the messages, and the upload validator runs
 * here. It never touches the network, the database, or object storage. Byte checks read only
 * the bytes the caller passes, never the client `Content-Type` header.
 */

/** AC2: the server refuses a file larger than this. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** The request body cap: one maximum file plus multipart overhead. */
export const ATTACHMENT_MAX_BODY_BYTES = ATTACHMENT_MAX_BYTES + 1024 * 1024;

/**
 * True when a request body is over the cap, or arrives without a declared length. A streamed
 * body cannot be measured before the framework reads it, so the request is refused.
 */
export function exceedsRequestBodyLimit(contentLength: string | null, hasBody: boolean): boolean {
  if (!hasBody) return false;
  if (contentLength === null) return true;
  const length = Number(contentLength);
  return !Number.isFinite(length) || length > ATTACHMENT_MAX_BODY_BYTES;
}
/** AC1: a draft holds at most this many attachments. */
export const ATTACHMENT_MAX_COUNT = 10;

export const ATTACHMENT_TOO_LARGE_MESSAGE =
  "This file is larger than 10 MB. Choose a smaller file.";
export const ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE =
  "This file type is not supported. Attach a PDF, PNG, JPEG, or DOCX file.";
export const ATTACHMENT_LIMIT_MESSAGE =
  "This draft already has 10 attachments. Remove one before adding another.";
/** AC4: storage is not configured, so attaching is unavailable and all else works. */
export const ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE =
  "File attachments are unavailable. Save the draft without files and try again later.";
export const ATTACHMENT_FILE_REQUIRED_MESSAGE = "Choose a file to attach.";
export const ATTACHMENT_ID_MESSAGE = "Choose an attachment";
export const ATTACHMENT_NOT_DRAFT_MESSAGE =
  "This request has been submitted and can no longer take attachments.";

/** Served content types, keyed by extension. The byte check below decides the stored value. */
export const ATTACHMENT_CONTENT_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type AttachmentExtension = keyof typeof ATTACHMENT_CONTENT_TYPES;

/** Every supported suffix, so lookups narrow without an assertion. */
const ATTACHMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "docx",
] as const satisfies readonly AttachmentExtension[];

/** The file input's `accept` value, derived from the supported extensions. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map(extension => `.${extension}`).join(",");

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  return new TextDecoder("latin1").decode(bytes).includes(needle);
}

/**
 * Identify the content type from the file's bytes, never the client header. PDF, PNG, and JPEG
 * carry magic numbers. DOCX is a ZIP (`PK\x03\x04`) holding `[Content_Types].xml` and a `word/`
 * entry; other ZIP-based formats (XLSX, ODT) have no `word/` entry and are refused. Answers
 * `null` for anything else. Residual risk: no malware scan.
 */
export function detectAttachmentContentType(bytes: Uint8Array): string | null {
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46])) return ATTACHMENT_CONTENT_TYPES.pdf;
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return ATTACHMENT_CONTENT_TYPES.png;
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return ATTACHMENT_CONTENT_TYPES.jpg;
  if (
    bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    containsAscii(bytes, "[Content_Types].xml") &&
    containsAscii(bytes, "word/")
  ) {
    return ATTACHMENT_CONTENT_TYPES.docx;
  }
  return null;
}

/** The object-key suffix for a stored content type. */
export function attachmentExtensionFor(contentType: string): AttachmentExtension {
  const match = ATTACHMENT_EXTENSIONS.find(
    extension => ATTACHMENT_CONTENT_TYPES[extension] === contentType
  );
  if (!match) throw new Error(ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE);
  return match;
}

/** Strip directories, control characters, and header-unsafe punctuation. Never blank. */
export function sanitizeAttachmentFilename(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "";
  const cleaned = base
    .replace(/[^\p{L}\p{N} .\-_()]/gu, "_")
    .replace(/_+/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 200)
    .trim();
  return cleaned === "" ? "attachment" : cleaned;
}

/**
 * The repo's first `FormData` server-function validator. The client sends the draft id and the
 * file as multipart fields. The id follows the Zod path (`safeParse`, first issue); the file
 * only needs presence here because its size and bytes are checked after parsing.
 */
export function parseAttachmentUpload(data: unknown): { id: number; file: File } {
  if (!(data instanceof FormData)) throw new Error(ATTACHMENT_FILE_REQUIRED_MESSAGE);
  const parsed = EventRequestIdInput.safeParse({ id: Number(data.get("id")) });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error(ATTACHMENT_FILE_REQUIRED_MESSAGE);
  if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
  return { id: parsed.data.id, file };
}

const AttachmentDownloadInput = EventRequestIdInput.extend({
  attachmentId: z.int32({ error: ATTACHMENT_ID_MESSAGE }).positive(ATTACHMENT_ID_MESSAGE),
});

export function parseAttachmentDownload(data: unknown): { id: number; attachmentId: number } {
  const parsed = AttachmentDownloadInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
