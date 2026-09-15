import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "#/routes/api/smoke";

const { mockEnv, mockExecute } = vi.hoisted(() => {
  const env: { SMOKE_TOKEN?: string } = {};
  return { mockEnv: env, mockExecute: vi.fn<() => Promise<unknown[]>>() };
});

vi.mock("#/env", () => ({ env: mockEnv }));
vi.mock("#/db", () => ({ db: { execute: mockExecute } }));

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

    // No header: without the explicit `!env.SMOKE_TOKEN` guard, `undefined === undefined`
    // would pass the Bearer check and touch the database.
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
    });
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});
