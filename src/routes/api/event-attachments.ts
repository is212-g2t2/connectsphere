import { createFileRoute } from "@tanstack/react-router";

import { ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";
import { logger } from "#/lib/logger";

const log = logger.getChild("event-attachments");

/**
 * Percent-encode a filename for the RFC 5987 `filename*` parameter. `encodeURIComponent` leaves
 * `'`, `(`, `)`, `*` unescaped, and those are not `attr-char`.
 */
function encodeFilenameValue(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/gu,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Build an attachment disposition for any filename. The quoted fallback stays ASCII; the real
 * name travels in `filename*`, because a header value above Latin-1 throws when the response is
 * built.
 */
function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_") || "attachment";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeFilenameValue(filename)}`;
}

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
          return new Response(Buffer.from(downloaded.bytes), {
            status: 200,
            headers: {
              "Content-Type": downloaded.contentType,
              "Content-Disposition": attachmentDisposition(downloaded.filename),
              "X-Content-Type-Options": "nosniff",
              "Content-Length": String(downloaded.bytes.length),
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
