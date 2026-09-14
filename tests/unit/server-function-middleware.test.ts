import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PTR-69: a server function is a directly addressable HTTP route, so "the route guard hid the
 * control" is not enforcement. Every `createServerFn` under `src/features` therefore declares the
 * middleware that verifies the session and the required permission before its handler can run —
 * `withSession`/`requireSession`/`requirePermission` in `src/features/auth/session.ts`.
 *
 * The behavioural half (401 and 403, with no handler execution) is
 * `tests/integration/server-function-authorization.test.ts`; this scan is what keeps the next
 * server function from being the one that omits the pipeline.
 */
const featuresDir = path.resolve(process.cwd(), "src/features");

function featureModules(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map(entry => path.join(dir, entry))
    .filter(filePath => filePath.endsWith(".ts") || filePath.endsWith(".tsx"));
}

describe("Server-function authorization pipeline (PTR-69)", () => {
  const modules = featureModules(featuresDir);

  it("finds feature modules to guard", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it("runs every createServerFn behind declared middleware", () => {
    const offenders: string[] = [];

    for (const filePath of modules) {
      const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
      const content = fs.readFileSync(filePath, "utf-8");

      for (const chain of content.match(/createServerFn\([\s\S]*?\.handler\(/g) ?? []) {
        if (!chain.includes(".middleware(")) {
          offenders.push(`${relPath}: ${chain.split("\n")[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
