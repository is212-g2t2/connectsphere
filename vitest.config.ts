import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "#": path.resolve(import.meta.dirname, "./src"),
      bun: path.resolve(import.meta.dirname, "./tests/shims/bun.ts"),
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      reporter: ["text", "json", "html"],
      enabled: true,
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
          environment: "jsdom",
          globals: true,
          setupFiles: [path.resolve(import.meta.dirname, "./tests/setup.ts")],
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
      },
    ],
  },
});
