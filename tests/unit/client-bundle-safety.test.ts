import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every module under the client-reachable shared directories — `src/features`, `src/lib`,
 * `src/components` — whether or not it declares a server function or imports a server module
 * today. Selecting on `createServerFn(` left a hole: a pure module a route imports reaches the
 * client bundle just the same. `src/db` stays out (server-only by construction) and so does
 * `src/routes` (its server routes import `.server` modules on purpose).
 *
 * `*.server.ts` modules are exempt and held from the other side instead:
 * `@tanstack/start-plugin-core` denies them in the client environment at build time.
 */
function getModules(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getModules(fullPath));
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
  /^(?:#\/db(?:\/[^"']*)?|bun|bun:[^"']*|drizzle-orm\/bun-sql|[^"']*\.server)$/;

/**
 * A static `import`/`export … from` statement, with its module specifier captured. Matched over
 * the whole file rather than line by line, so a wrapped import reads the same as a single-line
 * one — and a side-effect `import "#/db/schema";` is captured too. `import type` is excluded
 * (it is erased before the bundler sees it), and a dynamic `import(` has no space after the
 * keyword, so it never matches.
 */
const STATIC_IMPORT_SOURCE = /^[ \t]*(?:import|export)\s+(?!type\b)[^;]*?["']([^"']+)["']/gm;

const GUARDED_DIRS = ["src/features", "src/lib", "src/components"];

describe("Client-Reachable Module Client Safety", () => {
  const guardedModules = GUARDED_DIRS.flatMap(dir =>
    getModules(path.resolve(process.cwd(), dir))
  ).filter(filePath => !/\.server\.tsx?$/.test(filePath));

  it("finds client-reachable modules to guard", () => {
    expect(guardedModules.length).toBeGreaterThan(0);
  });

  guardedModules.forEach(filePath => {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

    it(`${relPath} does not statically import server-only modules at top level`, () => {
      const content = fs.readFileSync(filePath, "utf-8");

      const leakedImports = Array.from(content.matchAll(STATIC_IMPORT_SOURCE))
        .map(match => match[1])
        .filter(specifier => SERVER_ONLY_IMPORT.test(specifier));

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
