// oxlint-disable-next-line import/no-unassigned-import
import "zod/compile";
import { wrapFetchWithSentry } from "@sentry/tanstackstart-react";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { env } from "#/env";
import { configureAppLogging } from "#/lib/logger";

configureAppLogging({
  isDevelopment: import.meta.env.DEV,
  enableSentrySink: Boolean(env.VITE_SENTRY_DSN),
});

/**
 * Server entry point.
 * Wrap the TanStack Start fetch handler with Sentry to capture server errors and performance traces.
 */
export default createServerEntry(
  wrapFetchWithSentry({
    fetch(request: Request) {
      return handler.fetch(request);
    },
  })
);
