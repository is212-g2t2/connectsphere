import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { env } from "#/env";
import { auth } from "#/lib/auth";
import { getStorageClient, validateUploadRequest, safeExtension } from "#/lib/storage";
import { logger } from "#/lib/logger";
import { getRequest } from "@tanstack/react-start/server";

export const Route = createFileRoute("/api/upload-url")({
  server: {
    handlers: {
      POST: async () => {
        const request = getRequest();

        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const parsed = z
          .object({
            filename: z.string(),
            contentType: z.string(),
            size: z.number(),
          })
          .safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        const { filename, contentType, size } = parsed.data;

        const validationError = validateUploadRequest({ filename, contentType, size });
        if (validationError) {
          return Response.json({ error: validationError }, { status: 422 });
        }

        const client = getStorageClient(
          env.MINIO_ENDPOINT,
          env.MINIO_ACCESS_KEY,
          env.MINIO_SECRET_KEY,
          env.MINIO_BUCKET
        );

        if (!client) {
          return Response.json(
            { error: "Storage is not configured. Set MINIO_ENDPOINT to enable uploads." },
            { status: 503 }
          );
        }

        const ext = safeExtension(contentType);
        const key = `uploads/${session.user.id}/${crypto.randomUUID()}.${ext}`;

        const url = client.presign(key, {
          method: "PUT",
          expiresIn: 300,
          type: contentType,
        });

        logger.info("Generated presigned upload URL", {
          userId: session.user.id,
          key,
          contentType,
        });

        return Response.json({ url, key });
      },
    },
  },
});
