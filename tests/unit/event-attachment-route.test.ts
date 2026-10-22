import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";
import { Route } from "#/routes/api/event-attachments";

const { mockGetSession, mockHandleDownload, mockGetStorage } = vi.hoisted(() => ({
  mockGetSession: vi.fn<() => Promise<unknown>>(),
  mockHandleDownload:
    vi.fn<
      (data: unknown, user: unknown, database: unknown, storage: unknown) => Promise<unknown>
    >(),
  mockGetStorage: vi.fn<() => { marker: string } | null>(),
}));

class NotFoundError extends Error {
  readonly status = 404;
}

vi.mock("#/lib/auth.server", () => ({
  auth: { api: { getSession: mockGetSession } },
}));
vi.mock("#/features/auth/session", () => ({
  getSessionUser: (session: { user?: { id: string } } | null) => session?.user ?? null,
  NotFoundError,
}));
vi.mock("#/db", () => ({ db: {} }));
vi.mock("#/features/event-requests/attachments.server", () => ({
  getAttachmentStorage: mockGetStorage,
  handleDownloadEventAttachment: mockHandleDownload,
}));

function getHandler() {
  const handlers = Route.options.server?.handlers as
    | { GET?: (ctx: { request: Request }) => Promise<Response> }
    | undefined;
  const handler = handlers?.GET;
  if (!handler) throw new Error("GET handler is not defined on /api/event-attachments");
  return handler;
}

function downloadRequest(query: string) {
  return new Request(`http://localhost:3000/api/event-attachments${query}`, { method: "GET" });
}

const user = { id: "organiser-1" };

describe("GET /api/event-attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user });
    mockGetStorage.mockReturnValue({ marker: "bucket" });
  });

  it("returns 401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(401);
    expect(mockHandleDownload).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed id", async () => {
    const response = await getHandler()({ request: downloadRequest("?id=abc&attachmentId=7") });

    expect(response.status).toBe(400);
    expect(mockHandleDownload).not.toHaveBeenCalled();
  });

  it("serves the bytes as an attachment with nosniff", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 plan");
    mockHandleDownload.mockResolvedValue({
      filename: "floor-plan.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      bytes,
    });

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"floor-plan.pdf\"; filename*=UTF-8''floor-plan.pdf"
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mockHandleDownload).toHaveBeenCalledOnce();
  });

  it("serves a filename outside Latin-1 through the encoded form", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 plan");
    mockHandleDownload.mockResolvedValue({
      filename: "会议纪要.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      bytes,
    });

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="____.pdf"; filename*=UTF-8''${encodeURIComponent("会议纪要.pdf")}`
    );
  });

  it("escapes characters that are not RFC 5987 attr-char", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 plan");
    mockHandleDownload.mockResolvedValue({
      filename: "floor plan (1)'.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      bytes,
    });

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="floor plan (1)'.pdf"; filename*=UTF-8''floor%20plan%20%281%29%27.pdf`
    );
  });

  it("maps a missing attachment to 404", async () => {
    mockHandleDownload.mockRejectedValue(
      new NotFoundError("This attachment is no longer available.")
    );

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=999") });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "This attachment is no longer available.",
    });
  });

  it("maps an unexpected failure to a generic 500 without its detail", async () => {
    mockHandleDownload.mockRejectedValue(new Error("bucket secret is at https://internal"));

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not download this file. Try again.",
    });
  });

  it("answers 503 while storage is unconfigured", async () => {
    mockHandleDownload.mockRejectedValue(new Error(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE));

    const response = await getHandler()({ request: downloadRequest("?id=41&attachmentId=7") });

    expect(response.status).toBe(503);
  });
});
