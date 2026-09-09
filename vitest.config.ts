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
    coverage: {
      reporter: ["text", "json", "html"],
      enabled: true,
      exclude: ["tests/**"],
      thresholds: {
        lines: 50,
        functions: 45,
        branches: 50,
        statements: 50,
      },
    },
    passWithNoTests: true,
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
          setupFiles: [path.resolve(import.meta.dirname, "./tests/setup.ts")],
          globalSetup: "./tests/integration/integration-setup.ts",
        },
      },
    ],
  },
});
