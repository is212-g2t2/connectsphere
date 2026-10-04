import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "#/routes/api/cron/notifications";

const { mockEnv, mockDeliver } = vi.hoisted(() => {
  const env: { CRON_TOKEN?: string } = {};
  return {
    mockEnv: env,
    mockDeliver: vi.fn<(database: unknown) => Promise<unknown>>(),
  };
});

vi.mock("#/env", () => ({ env: mockEnv }));
vi.mock("#/db", () => ({ db: {} }));
vi.mock("#/features/notifications/deliver.server", () => ({
  deliverPendingNotifications: mockDeliver,
}));

function getPostHandler() {
  const handlers = Route.options.server?.handlers as
    | { POST?: (ctx: { request: Request }) => Promise<Response> }
    | undefined;
  const handler = handlers?.POST;
  if (!handler) {
    throw new Error("POST handler is not defined on /api/cron/notifications");
  }
  return handler;
}

function cronRequest(authorization?: string) {
  return new Request("http://localhost:3000/api/cron/notifications", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

describe("POST /api/cron/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.CRON_TOKEN = "cron-token";
    mockDeliver.mockResolvedValue({ sent: 0, failed: 0, pending: 0 });
  });

  it("returns 401 when no Authorization header is sent", async () => {
    const response = await getPostHandler()({ request: cronRequest() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("returns 401 when the Bearer token does not match", async () => {
    const response = await getPostHandler()({ request: cronRequest("Bearer wrong-token") });

    expect(response.status).toBe(401);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_TOKEN is not configured", async () => {
    mockEnv.CRON_TOKEN = undefined;

    // No header: without the explicit `!env.CRON_TOKEN` guard, `undefined === undefined`
    // would pass the Bearer check and deliver mail from an unauthenticated caller.
    const response = await getPostHandler()({ request: cronRequest() });

    expect(response.status).toBe(401);
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it("runs one delivery batch and answers with its result when the token matches", async () => {
    mockDeliver.mockResolvedValue({ sent: 2, failed: 1, pending: 3 });

    const response = await getPostHandler()({ request: cronRequest("Bearer cron-token") });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: 2, failed: 1, pending: 3 });
    expect(mockDeliver).toHaveBeenCalledOnce();
  });
});
