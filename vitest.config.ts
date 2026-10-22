import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "#": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      reporter: ["text", "json", "html"],
      // Unit and integration runs rewrite `coverage/`. Opt in with `COVERAGE=1`.
      // oxlint-disable-next-line node/no-process-env -- build-time config, not application code
      enabled: process.env.COVERAGE === "1",
      include: [
        "src/*.{ts,tsx}",
        "src/components/**/*.{ts,tsx}",
        "src/db/**/*.{ts,tsx}",
        "src/features/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
        "src/lib/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.d.ts",
        "src/components/ui/**",
        "src/db/drizzle/**",
        "src/routeTree.gen.ts",
        // E2E runs exercise app bootstrap. They do not collect coverage.
        "src/router.tsx",
        "src/server.ts",
        "src/start.ts",
      ],
      thresholds: {
        lines: 43,
        functions: 24,
        branches: 29,
        statements: 43,
      },
    },
    passWithNoTests: false,
    reporters: ["dot", "github-actions"],
    server: {
      deps: {
        inline: ["drizzle-orm"],
      },
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          // Node by default. Component and hook tests that render opt back into jsdom
          // with a `// @vitest-environment jsdom` comment at the top of the file.
          environment: "node",
          globals: true,
          setupFiles: [path.resolve(import.meta.dirname, "./tests/setup.ts")],
        },
        // Unit tests never touch the network. Point Bun's built-in modules at the
        // throwing shim, so a test that reaches the real bucket fails instead of passing.
        resolve: {
          alias: {
            bun: path.resolve(import.meta.dirname, "./tests/shims/bun.ts"),
          },
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          environment: "node",
          globals: true,
          // Share one Postgres container across all files. Tests that run `runSeed` can race with
          // tests that delete or count its rows, such as event-request and venue tests. Run these
          // files in sequence to avoid those races.
          fileParallelism: false,
          setupFiles: [path.resolve(import.meta.dirname, "./tests/setup.ts")],
          globalSetup: "./tests/integration/integration-setup.ts",
          server: {
            deps: {
              // Inline this code so `vi.mock` can replace it. The middleware runner reads TanStack
              // Start's async-local context. Tests provide that context by mocking its storage.
              inline: [
                /@tanstack\/react-start/,
                /@tanstack\/start-client-core/,
                /@tanstack\/start-storage-context/,
              ],
            },
          },
        },
        // Node-based Vitest cannot load Bun's built-in modules. Integration tests run
        // the real object store through a fetch-based S3 client with the same surface,
        // so `getAttachmentStorage()` talks to the testcontainer over real S3.
        resolve: {
          alias: {
            bun: path.resolve(import.meta.dirname, "./tests/shims/bun-integration.ts"),
          },
        },
      },
    ],
  },
});
