import * as Sentry from "@sentry/tanstackstart-react";

const sentryDsn = process.env.VITE_SENTRY_DSN;

if (!sentryDsn) {
  console.warn("VITE_SENTRY_DSN is not defined. Sentry is disabled.");
}

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    // Keep this baseline in sync with src/router.tsx (client init).
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
    // Keep server traces at 10% in production to control volume and cost.
    // Raise to 1.0 temporarily for debugging, then lower before shipping.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    integrations: [],
  });
}
