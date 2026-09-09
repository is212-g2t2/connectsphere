// oxlint-disable-next-line import/no-unassigned-import
import "zod/compile";
import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { QueryClient } from "@tanstack/react-query";

import { configureAppLogging } from "./lib/logger";
import { routeTree } from "./routeTree.gen";
import { env } from "./env";

export function getRouter() {
  const queryClient = new QueryClient();
  const context = { queryClient };

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  // Initialize Sentry on the client only (not during SSR)
  if (!router.isServer) {
    const globalState = globalThis as typeof globalThis & {
      __appSentryInitialized__?: boolean;
    };

    const sentryDsn = env.VITE_SENTRY_DSN;

    if (!globalState.__appSentryInitialized__ && sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        integrations: [
          Sentry.tanstackRouterBrowserTracingIntegration(router),
          Sentry.replayIntegration(),
        ],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        enableLogs: true,
        sendDefaultPii: false,
      });
      globalState.__appSentryInitialized__ = true;
    }

    configureAppLogging({
      isDevelopment: import.meta.env.DEV,
      enableSentrySink: Boolean(sentryDsn),
    });
  }

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
