import { createFileRoute } from "@tanstack/react-router";

import { ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";
import { logger } from "#/lib/logger";

const log = logger.getChild("event-attachments");

/**
 * Serve one event attachment as a download. Checks the session and the attachment allow-list
 * (the owning Organiser, the assigned Coordinator, a Lead, or a Safety Officer reviewing it)
 * on every request. Anyone else gets the same 404 as a missing attachment, never the bytes.
 * The response carries no storage URL, and no handler logs one.
 */
export const Route = createFileRoute("/api/event-attachments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ auth }, { getSessionUser, NotFoundError }] = await Promise.all([
          import("#/lib/auth.server"),
          import("#/features/auth/session"),
        ]);
        const session = await auth.api.getSession({ headers: request.headers });
        const user = getSessionUser(session);
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const { parseAttachmentDownload } = await import("#/features/event-requests/attachments");
        let input: { id: number; attachmentId: number };
        try {
          input = parseAttachmentDownload({
            id: Number(url.searchParams.get("id")),
            attachmentId: Number(url.searchParams.get("attachmentId")),
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Choose an attachment" },
            { status: 400 }
          );
        }

        const [{ db }, { getAttachmentStorage, handleDownloadEventAttachment }] = await Promise.all(
          [import("#/db"), import("#/features/event-requests/attachments.server")]
        );
        try {
          const downloaded = await handleDownloadEventAttachment(
            input,
            user,
            db,
            getAttachmentStorage()
          );
          const filename = downloaded.filename.replace(/["\\\r\n]/g, "_");
          return new Response(Buffer.from(downloaded.bytes), {
            status: 200,
            headers: {
              "Content-Type": downloaded.contentType,
              "Content-Disposition": `attachment; filename="${filename}"`,
              "X-Content-Type-Options": "nosniff",
              "Content-Length": String(downloaded.sizeBytes),
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          if (error instanceof NotFoundError) {
            return Response.json({ error: error.message }, { status: 404 });
          }
          if (error instanceof Error && error.message === ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE) {
            return Response.json({ error: error.message }, { status: 503 });
          }
          log.warn("Event attachment download failed", {
            eventId: input.id,
            attachmentId: input.attachmentId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          return Response.json(
            { error: "Could not download this file. Try again." },
            { status: 500 }
          );
        }
      },
    },
  },
});
