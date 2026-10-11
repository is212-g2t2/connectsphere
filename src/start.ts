import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { logger } from "#/lib/logger";

const loggerMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  logger.info("Incoming request", {
    method: request.method,
    url: new URL(request.url).pathname,
  });
  return next();
});

/**
 * TanStack Start instance with Sentry middleware and custom logging.
 *
 * - sentryGlobalRequestMiddleware adds request context to Sentry events.
 * - sentryGlobalFunctionMiddleware captures server-function errors.
 * - loggerMiddleware logs all requests for audit and metrics.
 *
 * Put these first in the arrays. They must capture errors and requests before other middleware
 * can handle them.
 */
export const startInstance = createStart(() => {
  return {
    requestMiddleware: [sentryGlobalRequestMiddleware, loggerMiddleware],
    functionMiddleware: [sentryGlobalFunctionMiddleware],
  };
});
