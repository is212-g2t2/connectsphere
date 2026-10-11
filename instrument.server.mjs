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
    // Keep 10% of server traces in production to control volume and cost.
    // Raise this to 1.0 for debugging, then lower it before release.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    integrations: [],
  });
}
