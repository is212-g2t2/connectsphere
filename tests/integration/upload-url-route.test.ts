import { describe, expect, it, vi, beforeEach } from "vitest";
import { Route } from "#/routes/api/upload-url";
import { auth } from "#/lib/auth";
import * as storage from "#/lib/storage";

let currentRequest: Request;

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => currentRequest,
}));

vi.mock("#/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn<() => Promise<unknown>>(),
    },
  },
}));

vi.mock("#/lib/storage", async importOriginal => {
  const original = await importOriginal<typeof storage>();
  return {
    ...original,
  };
});

vi.mock("#/env", () => ({
  env: {
    MINIO_ENDPOINT: "http://localhost:9000",
    MINIO_ACCESS_KEY: "minioadmin",
    MINIO_SECRET_KEY: "minioadmin",
    MINIO_BUCKET: "test-bucket",
  },
}));

function getPostHandler() {
  const handlers = Route.options.server?.handlers as { POST?: () => Promise<Response> } | undefined;
  const handler = handlers?.POST;
  if (!handler) {
    throw new Error("POST handler is not defined on /api/upload-url");
  }
  return handler;
}

describe("POST /api/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized if user is not authenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    currentRequest = new Request("http://localhost:3000/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "avatar.png",
        contentType: "image/png",
        size: 1024,
      }),
    });

    const handler = getPostHandler();
    const response = await handler();
    expect(response.status).toBe(401);

    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 Bad Request if body format is invalid", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "usr_123", email: "user@example.com" },
      session: { id: "sess_123" },
    } as never);

    currentRequest = new Request("http://localhost:3000/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "avatar.png",
        // missing contentType and size
      }),
    });

    const handler = getPostHandler();
    const response = await handler();
    expect(response.status).toBe(400);

    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("Invalid request body");
  });

  it("returns 422 Unprocessable Entity if file exceeds size limit or has disallowed type", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "usr_123", email: "user@example.com" },
      session: { id: "sess_123" },
    } as never);

    currentRequest = new Request("http://localhost:3000/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "malicious.exe",
        contentType: "application/x-msdownload",
        size: 1024,
      }),
    });

    const handler = getPostHandler();
    const response = await handler();
    expect(response.status).toBe(422);

    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("Unsupported file type");
  });

  it("returns 200 and presigned URL details on valid request", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "usr_123", email: "user@example.com" },
      session: { id: "sess_123" },
    } as never);

    currentRequest = new Request("http://localhost:3000/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 2048,
      }),
    });

    const handler = getPostHandler();
    const response = await handler();
    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      url: string;
      key: string;
    };
    expect(json.url).toContain("uploads/usr_123/");
    expect(json.key).toMatch(/^uploads\/usr_123\/[0-9a-f-]+\.jpg$/);
  });

  it("returns 503 Service Unavailable if storage is not configured", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "usr_123", email: "user@example.com" },
      session: { id: "sess_123" },
    } as never);

    vi.spyOn(storage, "getStorageClient").mockReturnValueOnce(null);

    currentRequest = new Request("http://localhost:3000/api/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 2048,
      }),
    });

    const handler = getPostHandler();
    const response = await handler();
    expect(response.status).toBe(503);

    const json = (await response.json()) as { error: string };
    expect(json.error).toContain("Storage is not configured");
  });
});
