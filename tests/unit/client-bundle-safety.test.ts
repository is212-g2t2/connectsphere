import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every module under `src/features`, not only the ones declaring a server function.
 *
 * Selecting on `createServerFn(` used to leave a hole: a pure module a route imports — the
 * role/function matrix, say — carries no server function of its own, yet reaches the client
 * bundle just the same. A server import there fails `bun run build` alone, so nothing else in
 * the suite would have caught it.
 *
 * `*.server.ts` modules are exempt and checked from the other side instead: nothing
 * client-reachable may import them, which is the rule that keeps them off the client.
 */
function getFeatureModules(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFeatureModules(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * `#/db` alone used to be the whole list, which let `#/db/schema` through — a value import of
 * the table definitions, which drizzle builds by calling `pgTable()` at module scope. A bundler
 * cannot prove that side-effect free, so the module is retained whole and the entire schema,
 * Better Auth tables included, is served to the browser. It never fails `bun run build`, so the
 * only thing standing between that and production is this test.
 */
const SERVER_ONLY_IMPORT =
  /from\s*["'](#\/db(\/[^"']*)?|bun|bun:[^"']*|drizzle-orm\/bun-sql|[^"']*\.server)["']/;

describe("Route-Reachable Feature Module Client Safety", () => {
  const featuresDir = path.resolve(process.cwd(), "src/features");
  const featureModules = getFeatureModules(featuresDir).filter(
    filePath => !/\.server\.tsx?$/.test(filePath)
  );

  it("finds feature modules to guard", () => {
    expect(featureModules.length).toBeGreaterThan(0);
  });

  featureModules.forEach(filePath => {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

    it(`${relPath} does not statically import server-only modules at top level`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      const leakedImports = lines
        .map(line => line.trim())
        .filter(
          line =>
            (line.startsWith("import ") || line.startsWith("export ")) &&
            !line.startsWith("import type") &&
            !line.startsWith("export type") &&
            !line.includes("import(") &&
            SERVER_ONLY_IMPORT.test(line)
        );

      expect(leakedImports).toEqual([]);
    });

    it(`${relPath} does not anchor database default parameter on exported functions`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      // Prevent pattern: `export (async )?function ... (..., database = db)`
      const leakedDefaultParamRegex = /export\s+(?:async\s+)?function\s+\w+\s*\([^)]*=\s*db\b/;
      expect(content).not.toMatch(leakedDefaultParamRegex);
    });
  });
});
