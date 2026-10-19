import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { env } from "#/env";

export const Route = createFileRoute("/api/smoke")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "");
        if (!env.SMOKE_TOKEN || token !== env.SMOKE_TOKEN) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const { db } = await import("#/db");
        await db.execute(sql`select 1`);

        // Upload and delete a test object through the real bucket when storage is
        // configured, so the release pipeline fails while the bucket is unreachable.
        const { getAttachmentStorage, runAttachmentSmokeCheck } =
          await import("#/features/event-requests/attachments.server");
        const storage = getAttachmentStorage();
        if (storage) {
          await runAttachmentSmokeCheck(storage);
        }

        // Cloud Run injects K_REVISION. It has no local meaning. Keep it out of the schema.
        return Response.json({
          ok: true,
          // oxlint-disable-next-line node/no-process-env
          revision: process.env.K_REVISION ?? "local",
          storage: storage ? "ok" : "unconfigured",
        });
      },
    },
  },
});
