import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PTR-75: route modules are routing, and nothing else.
 *
 * `dashboard.tsx` (177 lines) and `settings.tsx` (143 lines) carried their views beside the routing
 * configuration, so those pages needed a router to render. Views now live under
 * `src/features/<feature>/components/`. These assertions stop the next view from moving back;
 * no other test would notice.
 *
 * The checks are textual on purpose. They check where a declaration sits in the file. A file
 * read is the cheapest way to hold a boundary that no rendering can check.
 */
const routesDir = path.resolve(process.cwd(), "src/routes");

function routeModules(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeModules(fullPath);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

function relative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

/** Match top-level `function`, `const`, `class`, and `type` declarations by name. */
const TOP_LEVEL_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/** Match React state and lifecycle APIs. Route modules must not use them. */
const VIEW_HOOK =
  /\buse(?:State|Effect|LayoutEffect|Ref|Memo|Callback|Reducer|Transition|ImperativeHandle)\s*\(/;

/** Match the directory where page views belong. */
const FEATURE_VIEW_IMPORT = /from\s*["']#\/features\/[^"']+\/components\/[^"']+["']/;

describe("Route module boundaries", () => {
  const allRoutes = routeModules(routesDir);
  // Only rendering routes belong here. API handlers and crawler formats use `.ts` files and keep
  // their request-handling helpers.
  const renderingRoutes = allRoutes.filter(filePath => filePath.endsWith(".tsx"));

  it("finds the route modules to hold", () => {
    expect(renderingRoutes.length).toBeGreaterThan(0);
  });

  renderingRoutes.forEach(filePath => {
    const relPath = relative(filePath);
    const content = fs.readFileSync(filePath, "utf-8");

    it(`${relPath} declares the route and nothing else`, () => {
      const declared = content
        .split("\n")
        .map(line => TOP_LEVEL_DECLARATION.exec(line)?.[1])
        .filter((name): name is string => name !== undefined);

      expect(declared).toEqual(["Route"]);
    });

    it(`${relPath} keeps view state out of the route`, () => {
      expect(VIEW_HOOK.test(content)).toBe(false);
    });
  });

  it("imports every page view from its feature's components directory", () => {
    const offenders = renderingRoutes
      // `__root.tsx` renders the document shell and its two boundaries, not a page view. Its
      // components therefore come from `src/components/`.
      .filter(filePath => path.basename(filePath) !== "__root.tsx")
      .filter(filePath => {
        const content = fs.readFileSync(filePath, "utf-8");
        // `_authenticated.tsx` is a pathless layout and renders nothing.
        return /\bcomponent:/.test(content) && !FEATURE_VIEW_IMPORT.test(content);
      });

    expect(offenders.map(relative)).toEqual([]);
  });

  it("keeps shared components out of every route module but the root", () => {
    const offenders = allRoutes
      .filter(filePath => path.basename(filePath) !== "__root.tsx")
      .filter(filePath => /from\s*["']#\/components\//.test(fs.readFileSync(filePath, "utf-8")));

    expect(offenders.map(relative)).toEqual([]);
  });
});
