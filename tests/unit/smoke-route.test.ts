import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "#/routes/api/smoke";

const { mockEnv, mockExecute, mockGetAttachmentStorage, mockRunAttachmentSmokeCheck } = vi.hoisted(
  () => {
    const env: { SMOKE_TOKEN?: string } = {};
    return {
      mockEnv: env,
      mockExecute: vi.fn<() => Promise<unknown[]>>(),
      mockGetAttachmentStorage: vi.fn<() => { marker: string } | null>(),
      mockRunAttachmentSmokeCheck: vi.fn<() => Promise<void>>(),
    };
  }
);

vi.mock("#/env", () => ({ env: mockEnv }));
vi.mock("#/db", () => ({ db: { execute: mockExecute } }));
vi.mock("#/features/event-requests/attachments.server", () => ({
  getAttachmentStorage: mockGetAttachmentStorage,
  runAttachmentSmokeCheck: mockRunAttachmentSmokeCheck,
}));

function getGetHandler() {
  const handlers = Route.options.server?.handlers as
    | { GET?: (ctx: { request: Request }) => Promise<Response> }
    | undefined;
  const handler = handlers?.GET;
  if (!handler) {
    throw new Error("GET handler is not defined on /api/smoke");
  }
  return handler;
}

function smokeRequest(authorization?: string) {
  return new Request("http://localhost:3000/api/smoke", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("GET /api/smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.SMOKE_TOKEN = "smoke-token";
    mockExecute.mockResolvedValue([]);
    mockGetAttachmentStorage.mockReturnValue(null);
    mockRunAttachmentSmokeCheck.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when no Authorization header is sent", async () => {
    const response = await getGetHandler()({ request: smokeRequest() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 401 when the Bearer token does not match", async () => {
    const response = await getGetHandler()({ request: smokeRequest("Bearer wrong-token") });

    expect(response.status).toBe(401);
  });

  it("returns 401 when SMOKE_TOKEN is not configured", async () => {
    mockEnv.SMOKE_TOKEN = undefined;

    // Send no header. Without the explicit `!env.SMOKE_TOKEN` guard, `undefined === undefined`
    // passes the Bearer check. It touches the database.
    const response = await getGetHandler()({ request: smokeRequest() });

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("runs the database check and echoes the Cloud Run revision when the token matches", async () => {
    vi.stubEnv("K_REVISION", "connectsphere-00042-abc");

    const response = await getGetHandler()({ request: smokeRequest("Bearer smoke-token") });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      revision: "connectsphere-00042-abc",
      storage: "unconfigured",
    });
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockRunAttachmentSmokeCheck).not.toHaveBeenCalled();
  });

  it("round-trips a test object through the real bucket when storage is configured", async () => {
    const storage = { marker: "bucket" };
    mockGetAttachmentStorage.mockReturnValue(storage);

    const response = await getGetHandler()({ request: smokeRequest("Bearer smoke-token") });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      revision: "local",
      storage: "ok",
    });
    expect(mockRunAttachmentSmokeCheck).toHaveBeenCalledExactlyOnceWith(storage);
  });

  it("fails while the configured bucket is unreachable", async () => {
    mockGetAttachmentStorage.mockReturnValue({ marker: "bucket" });
    mockRunAttachmentSmokeCheck.mockRejectedValue(new Error("bucket down"));

    // As with a database failure, the error travels and the platform answers 500.
    await expect(getGetHandler()({ request: smokeRequest("Bearer smoke-token") })).rejects.toThrow(
      "bucket down"
    );
  });
});
