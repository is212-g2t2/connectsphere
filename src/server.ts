// oxlint-disable-next-line import/no-unassigned-import
import "zod/compile";
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

/**
 * Server entry point.
 * Wraps the TanStack Start fetch handler with Sentry to capture
 * server-side errors and performance traces automatically.
 */
export default createServerEntry(
  wrapFetchWithSentry({
    fetch(request: Request) {
      return handler.fetch(request);
    },
  })
);
