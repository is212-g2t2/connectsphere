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

describe("Route-Reachable Feature Module Client Safety", () => {
  const featuresDir = path.resolve(process.cwd(), "src/features");
  const featureModules = getFeatureModules(featuresDir);

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
            line.startsWith("import ") &&
            !line.startsWith("import type") &&
            !line.includes("import(") &&
            /from\s*["'](#\/db|bun|drizzle-orm\/bun-sql)["']/.test(line)
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
