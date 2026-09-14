import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PTR-68: route guards stay per-route presentation checks.
 *
 * The session is resolved once; a route fetching it again spends a roundtrip that navigation
 * already paid for. And a permission check modelled as a pathless layout route brings back the
 * layout-per-permission explosion the audit rejected, so the only pathless layout under
 * `src/routes` is the authentication boundary itself.
 *
 * PTR-73 moved that single resolution up to `__root.tsx`, because the header renders outside
 * `_authenticated` and needs the same user: the boundary now narrows what the root already put
 * on context, and the unauthenticated routes read it from there too.
 */
const routesDir = path.resolve(process.cwd(), "src/routes");

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

describe("Route-level permission guards", () => {
  it("resolves the session in __root.tsx alone", () => {
    const resolvers = routeFiles(routesDir)
      .filter(filePath => /\bgetCurrentUser\b/.test(fs.readFileSync(filePath, "utf-8")))
      .map(filePath => path.relative(routesDir, filePath));

    expect(resolvers).toEqual(["__root.tsx"]);
  });

  it("keeps _authenticated the only pathless layout route", () => {
    const layouts = fs
      .readdirSync(routesDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith("_") && entry.name !== "__root.tsx")
      .map(entry => entry.name);

    expect(layouts).toEqual(["_authenticated.tsx"]);
  });
});
