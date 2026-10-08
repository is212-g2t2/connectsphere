import { createFileRoute } from "@tanstack/react-router";

import { env } from "#/env";
import { logger } from "#/lib/logger";

/**
 * PTR-55: the every-minute worker. Cloud Scheduler calls this with the `CRON_TOKEN`
 * bearer; the handler sweeps the registration boundaries first, then runs one delivery
 * batch, and answers with what it did, so a run is observable from
 * the scheduler's own result. The delivery module — and `#/db` with it — is imported dynamically:
 * a static `#/db/schema` import in a route file would ship the whole schema to the client build
 * (the trap AGENTS.md documents, which the bundle-safety test does not scan `src/routes` for).
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

/** Bearer check mirroring `/api/smoke`, compared in constant time; an unset token fails closed. */
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
