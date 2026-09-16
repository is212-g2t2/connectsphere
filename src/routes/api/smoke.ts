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

        // K_REVISION is injected by Cloud Run and has no local meaning, so it stays out of the schema.
        // oxlint-disable-next-line node/no-process-env
        return Response.json({ ok: true, revision: process.env.K_REVISION ?? "local" });
      },
    },
  },
});
