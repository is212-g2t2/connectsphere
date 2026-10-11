import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** PTR-68 keeps permission checks with each route and resolves the session once. A second fetch
 * repeats work that navigation already did. A layout for each permission would add too many
 * pathless routes, so keep only the authentication boundary pathless.
 *
 * PTR-73 moved session resolution to `__root.tsx` because the header sits outside
 * `_authenticated`. The boundary narrows the user already in context. Public routes read it there
 * too.
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
      .filter(filePath => /\bgetSessionContext\b/.test(fs.readFileSync(filePath, "utf-8")))
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
