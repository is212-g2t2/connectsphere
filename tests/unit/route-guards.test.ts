import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PTR-68: route guards stay per-route presentation checks.
 *
 * `_authenticated.tsx` resolves the session once; a child route fetching it again spends a
 * roundtrip the layout already paid for. And a permission check modelled as a pathless layout
 * route brings back the layout-per-permission explosion the audit rejected, so the only
 * pathless layout under `src/routes` is the authentication boundary itself.
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
  const authenticatedRoutes = routeFiles(path.join(routesDir, "_authenticated"));

  it("finds the routes beneath the authentication boundary", () => {
    expect(authenticatedRoutes.length).toBeGreaterThan(0);
  });

  it("never fetches the session again in a route beneath _authenticated", () => {
    const offenders = authenticatedRoutes.filter(filePath =>
      /\bgetCurrentUser\b/.test(fs.readFileSync(filePath, "utf-8"))
    );

    expect(offenders.map(filePath => path.relative(process.cwd(), filePath))).toEqual([]);
  });

  it("keeps _authenticated the only pathless layout route", () => {
    const layouts = fs
      .readdirSync(routesDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith("_") && entry.name !== "__root.tsx")
      .map(entry => entry.name);

    expect(layouts).toEqual(["_authenticated.tsx"]);
  });
});
