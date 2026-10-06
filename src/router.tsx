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
    // PTR-22 AC3: a revisit waits for its loaders, so a page never renders a cached value that a
    // later change replaced. The default (`background`) shows the cached copy first.
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
        // Derived from the origin so one image stays valid for both environments.
        environment: location.hostname.startsWith("connectsphere-staging")
          ? "staging"
          : "production",
        integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: REPLAY_SESSION_SAMPLE_RATE,
        replaysOnErrorSampleRate: REPLAY_ERROR_SAMPLE_RATE,
        // Keep this baseline in sync with instrument.server.mjs (server init).
        // Sentry v11 collects request bodies, cookies and user info by default. Keep the
        // v10 privacy posture explicitly; widen a category only after reviewing data-handling.
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

      // Replay's rrweb payload is fetched from Sentry's CDN instead of shipping in the entry
      // chunk; the integration applies its own sampling, so this only gates whether it loads.
      // Tradeoff: there is no pre-error replay buffer until the CDN fetch resolves.
      if (REPLAY_SESSION_SAMPLE_RATE > 0 || REPLAY_ERROR_SAMPLE_RATE > 0) {
        void Sentry.lazyLoadIntegration("replayIntegration")
          .then(replayIntegration => Sentry.addIntegration(replayIntegration()))
          .catch(() => {
            // A blocked or failed CDN fetch must not break the app; tracing still works.
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
