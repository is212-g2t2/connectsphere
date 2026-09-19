import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const plugin = { pluginId: "infer-additional-fields" };
  const client = { clientId: "auth-client" };
  return {
    plugin,
    client,
    inferAdditionalFields: vi.fn<() => typeof plugin>(() => plugin),
    createAuthClient: vi.fn<(config: { plugins: unknown[] }) => typeof client>(() => client),
  };
});

vi.mock("better-auth/react", () => ({ createAuthClient: mocks.createAuthClient }));
vi.mock("better-auth/client/plugins", () => ({
  inferAdditionalFields: mocks.inferAdditionalFields,
}));

/**
 * The file is a single expression: build Better Auth's client and tell it to infer the additional
 * profile fields declared on the server's `auth`. Mocking both constructors is the only way to
 * observe that wiring, since the returned client is otherwise opaque.
 *
 * The import is dynamic because the calls happen once at module evaluation, and the suite's global
 * `clearMocks` wipes them before every test; re-importing after `resetModules` records them here.
 */
describe("authClient", () => {
  it("creates the client with the additional fields inferred from the server auth", async () => {
    vi.resetModules();
    const { authClient } = await import("#/lib/auth-client");

    expect(mocks.inferAdditionalFields).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthClient).toHaveBeenCalledExactlyOnceWith({ plugins: [mocks.plugin] });
    expect(authClient).toBe(mocks.client);
  });
});
