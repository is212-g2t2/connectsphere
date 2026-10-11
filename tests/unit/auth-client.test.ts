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

/** Build the client and verify that it infers the server's additional auth fields.
 * Mock both constructors because the returned client is opaque. Re-import after `resetModules`:
 * `clearMocks` runs before each test, and the import runs once per module load.
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
