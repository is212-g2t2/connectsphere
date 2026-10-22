import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_FILE_REQUIRED_MESSAGE,
  ATTACHMENT_ID_MESSAGE,
  ATTACHMENT_LIMIT_MESSAGE,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
  attachmentExtensionFor,
  detectAttachmentContentType,
  parseAttachmentDownload,
  parseAttachmentUpload,
  sanitizeAttachmentFilename,
} from "#/features/event-requests/attachments";
import { EVENT_REQUEST_ID_MESSAGE } from "#/features/event-requests/schema";

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Minimal DOCX-shaped bytes: a ZIP holding `[Content_Types].xml` and a `word/` entry. */
function docxBytes(): Uint8Array {
  return concat(
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    ascii("filler[Content_Types].xmlfillerword/document.xmlfiller")
  );
}

describe("Attachment limits and messages", () => {
  it("caps files at 10 MB and drafts at 10 attachments", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_MAX_COUNT).toBe(10);
  });

  it("names the reason in every refusal", () => {
    for (const message of [
      ATTACHMENT_TOO_LARGE_MESSAGE,
      ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE,
      ATTACHMENT_LIMIT_MESSAGE,
      ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
    ]) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("accepts only the four supported extensions in the file input", () => {
    expect(ATTACHMENT_ACCEPT).toBe(".pdf,.png,.jpg,.jpeg,.docx");
    expect(Object.values(ATTACHMENT_CONTENT_TYPES)).toHaveLength(4);
  });
});

describe("detectAttachmentContentType", () => {
  it("identifies PDF, PNG, and JPEG by their magic numbers", () => {
    expect(detectAttachmentContentType(ascii("%PDF-1.7 rest"))).toBe(ATTACHMENT_CONTENT_TYPES.pdf);
    expect(
      detectAttachmentContentType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
      )
    ).toBe(ATTACHMENT_CONTENT_TYPES.png);
    expect(detectAttachmentContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      ATTACHMENT_CONTENT_TYPES.jpg
    );
  });

  it("identifies DOCX as a ZIP holding [Content_Types].xml and a word/ entry", () => {
    expect(detectAttachmentContentType(docxBytes())).toBe(ATTACHMENT_CONTENT_TYPES.docx);
  });

  it("refuses an empty file, plain text, and a truncated PNG", () => {
    expect(detectAttachmentContentType(new Uint8Array([]))).toBeNull();
    expect(detectAttachmentContentType(ascii("just text"))).toBeNull();
    expect(detectAttachmentContentType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it("refuses a ZIP without a word/ entry, such as a spreadsheet", () => {
    const xlsxLike = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      ascii("filler[Content_Types].xmlfillerxl/workbook.xml")
    );
    expect(detectAttachmentContentType(xlsxLike)).toBeNull();
  });

  it("refuses a ZIP without [Content_Types].xml", () => {
    const plainZip = concat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), ascii("word/nothing"));
    expect(detectAttachmentContentType(plainZip)).toBeNull();
  });

  it("never reads the client Content-Type header", () => {
    // A PDF renamed to .exe still identifies as PDF from its bytes alone.
    expect(detectAttachmentContentType(ascii("%PDF renamed"))).toBe(ATTACHMENT_CONTENT_TYPES.pdf);
  });
});

describe("attachmentExtensionFor", () => {
  it("maps each stored content type to its object-key suffix", () => {
    expect(attachmentExtensionFor(ATTACHMENT_CONTENT_TYPES.pdf)).toBe("pdf");
    expect(attachmentExtensionFor(ATTACHMENT_CONTENT_TYPES.png)).toBe("png");
    expect(attachmentExtensionFor(ATTACHMENT_CONTENT_TYPES.jpg)).toBe("jpg");
    expect(attachmentExtensionFor(ATTACHMENT_CONTENT_TYPES.docx)).toBe("docx");
  });

  it("refuses an unknown content type", () => {
    expect(() => attachmentExtensionFor("text/plain")).toThrow(ATTACHMENT_UNSUPPORTED_TYPE_MESSAGE);
  });
});

describe("sanitizeAttachmentFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeAttachmentFilename("Floor Plan v2.pdf")).toBe("Floor Plan v2.pdf");
  });

  it("strips directory traversal to the base name", () => {
    expect(sanitizeAttachmentFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeAttachmentFilename("C:\\fakepath\\plan.pdf")).toBe("plan.pdf");
  });

  it("replaces header-unsafe punctuation and control characters", () => {
    expect(sanitizeAttachmentFilename('a"b;c\nplan.pdf')).toBe("a_b_c_plan.pdf");
  });

  it("falls back to attachment when nothing safe remains", () => {
    expect(sanitizeAttachmentFilename("")).toBe("attachment");
    expect(sanitizeAttachmentFilename("...")).toBe("attachment");
  });
});

function uploadForm(id: string, file?: File): FormData {
  const form = new FormData();
  form.set("id", id);
  if (file) form.set("file", file);
  return form;
}

describe("parseAttachmentUpload", () => {
  it("parses the draft id and the file from FormData", () => {
    const file = new File([ascii("%PDF-1.4")], "plan.pdf", { type: "application/pdf" });
    expect(parseAttachmentUpload(uploadForm("41", file))).toEqual({ id: 41, file });
  });

  it("refuses a missing or empty file", () => {
    expect(() => parseAttachmentUpload(uploadForm("41"))).toThrow(ATTACHMENT_FILE_REQUIRED_MESSAGE);
    expect(() => parseAttachmentUpload(uploadForm("41", new File([], "empty.pdf")))).toThrow(
      ATTACHMENT_FILE_REQUIRED_MESSAGE
    );
  });

  it("refuses a non-FormData payload and a bad draft id", () => {
    expect(() => parseAttachmentUpload({ id: 41 })).toThrow(ATTACHMENT_FILE_REQUIRED_MESSAGE);
    const file = new File([ascii("%PDF")], "plan.pdf");
    expect(() => parseAttachmentUpload(uploadForm("abc", file))).toThrow(EVENT_REQUEST_ID_MESSAGE);
  });
});

describe("parseAttachmentDownload", () => {
  it("parses the draft and attachment ids", () => {
    expect(parseAttachmentDownload({ id: 41, attachmentId: 7 })).toEqual({
      id: 41,
      attachmentId: 7,
    });
  });

  it("names a bad attachment id", () => {
    expect(() => parseAttachmentDownload({ id: 41, attachmentId: 0 })).toThrow(
      ATTACHMENT_ID_MESSAGE
    );
    expect(() => parseAttachmentDownload({ id: 41 })).toThrow(ATTACHMENT_ID_MESSAGE);
  });
});
