import { createFileRoute } from "@tanstack/react-router";

import { env } from "#/env";
import { logger } from "#/lib/logger";

/**
 * PTR-55: Cloud Scheduler calls this worker every minute with the `CRON_TOKEN` bearer token.
 * First sweep registration boundaries, then run one delivery batch.
 * Return the work result so Cloud Scheduler can show each run.
 * Import the delivery module and `#/db` dynamically. A static `#/db/schema` import from a route
 * would ship the full schema to the client build. The bundle-safety test does not scan `src/routes`.
 */
export const Route = createFileRoute("/api/cron/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await cronAuthorized(request))) {
          logger.getChild("cron").warn("Rejected an unauthorized notification worker request");
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const [{ db }, { deliverPendingNotifications }, { sweepRegistrationWindows }] =
          await Promise.all([
            import("#/db"),
            import("#/features/notifications/deliver.server"),
            import("#/features/events/registration-boundaries.server"),
          ]);

        let raised: number | "failed" = 0;
        try {
          raised = await sweepRegistrationWindows(db);
        } catch (error) {
          logger.getChild("cron").error("Registration sweep failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          raised = "failed";
        }
        const delivered = await deliverPendingNotifications(db);
        return Response.json({ raised, ...delivered });
      },
    },
  },
});

/** Check the bearer token as `/api/smoke` does. Compare it in constant time, and reject requests if it is unset. */
async function cronAuthorized(request: Request): Promise<boolean> {
  const expected = env.CRON_TOKEN;
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "");
  if (!expected || !presented) return false;

  const { timingSafeEqual } = await import("node:crypto");
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return (
    presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes)
  );
}
