import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function getServerFnFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getServerFnFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      if (content.includes("createServerFn(")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

describe("Route-Reachable Server Functions Client Safety", () => {
  const featuresDir = path.resolve(process.cwd(), "src/features");
  const serverFnFiles = getServerFnFiles(featuresDir);

  it("finds at least one server function file to guard", () => {
    expect(serverFnFiles.length).toBeGreaterThan(0);
  });

  serverFnFiles.forEach(filePath => {
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
