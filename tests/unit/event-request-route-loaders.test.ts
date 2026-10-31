import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The event-request routes offer the maintained room layout list, but a failed layout read must
 * not replace the form with the root error page. The loaders degrade to `undefined` and the form
 * falls back to the initials, as `load-page-data.ts` does. The new route shows the page skeleton
 * while its loader runs, as the reopen route does.
 *
 * The checks are textual on purpose, as in `route-module-boundaries.test.ts`. Route modules keep
 * only wiring, so no rendering can check them.
 */
const routesDir = path.resolve(process.cwd(), "src/routes/_authenticated/event-requests");

function routeSource(name: string) {
  return fs.readFileSync(path.join(routesDir, name), "utf-8");
}

describe("Event request route loaders", () => {
  it.each(["new.tsx", "reopenDraft.$id.tsx"])(
    "%s degrades a failed room-layout read to undefined",
    name => {
      expect(routeSource(name)).toMatch(/listRoomLayouts\(\)\.catch\(/);
    }
  );

  it("new.tsx shows the page skeleton while its loader runs", () => {
    expect(routeSource("new.tsx")).toMatch(/pendingComponent:\s*EventRequestsPageSkeleton/);
  });
});
