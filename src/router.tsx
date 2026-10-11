// oxlint-disable-next-line import/no-unassigned-import
import "zod/compile";
import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { configureAppLogging } from "./lib/logger";
import { routeTree } from "./routeTree.gen";
import { env } from "./env";

const REPLAY_SESSION_SAMPLE_RATE: number = 0.1;
const REPLAY_ERROR_SAMPLE_RATE: number = 1;

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // PTR-22 AC3: wait for loaders on a revisit so the page does not show stale cached data. The
    // default (`background`) shows cached data first. This makes revisits slower. With
    // `defaultPreloadStaleTime: 0`, the click fetches a finished hover preload again. It reuses a
    // preload that is still in flight.
    defaultStaleReloadMode: "blocking",
  });

  // Initialize Sentry on the client only (not during SSR)
  if (!router.isServer) {
    const globalState = globalThis as typeof globalThis & {
      __appSentryInitialized__?: boolean;
    };

    const sentryDsn = env.VITE_SENTRY_DSN;

    if (!globalState.__appSentryInitialized__ && sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        // Build the URL from the origin so one image works in both environments.
        environment: location.hostname.startsWith("connectsphere-staging")
          ? "staging"
          : "production",
        integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: REPLAY_SESSION_SAMPLE_RATE,
        replaysOnErrorSampleRate: REPLAY_ERROR_SAMPLE_RATE,
        // Keep this configuration in sync with the server setup in instrument.server.mjs.
        // Sentry v11 collects request bodies, cookies, and user information by default. Keep the
        // v10 privacy settings. Review data handling before you enable another category.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: {
            request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
            response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
          },
          httpBodies: [],
          urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
          genAI: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          graphQL: { document: false, variables: false },
        },
      });
      globalState.__appSentryInitialized__ = true;

      // Fetch Replay's rrweb payload from Sentry's CDN instead of adding it to the entry chunk.
      // The integration applies its own sampling, so this option only controls whether it loads.
      // Replay cannot record session data from before an error until the CDN fetch completes.
      if (REPLAY_SESSION_SAMPLE_RATE > 0 || REPLAY_ERROR_SAMPLE_RATE > 0) {
        void Sentry.lazyLoadIntegration("replayIntegration")
          .then(replayIntegration => Sentry.addIntegration(replayIntegration()))
          .catch(() => {
            // Do not let a blocked or failed CDN fetch break the app. Tracing still works.
          });
      }
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
