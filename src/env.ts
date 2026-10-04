import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    SERVER_URL: z.url().optional(),
    DATABASE_URL: z.url(),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z.string().min(32),
    SMOKE_TOKEN: z.string().optional(),
    CRON_TOKEN: z.string().min(1).optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.email().optional(),
    SMTP_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
    VITE_SENTRY_DSN: z.url().optional(),
    VITE_SENTRY_ORG: z.string().optional(),
    VITE_SENTRY_PROJECT: z.string().optional(),
  },
  runtimeEnv: {
    SERVER_URL: process.env.SERVER_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    SMOKE_TOKEN: process.env.SMOKE_TOKEN,
    CRON_TOKEN: process.env.CRON_TOKEN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SMTP_URL: process.env.SMTP_URL,
    REDIS_URL: process.env.REDIS_URL,
    // import.meta.env is Vite-only; fallback to process.env in Node.js (e.g. drizzle-kit, instrument.server.mjs)
    VITE_APP_TITLE: process.env.VITE_APP_TITLE ?? import.meta.env?.VITE_APP_TITLE,
    VITE_SENTRY_DSN: process.env.VITE_SENTRY_DSN ?? import.meta.env?.VITE_SENTRY_DSN,
    VITE_SENTRY_ORG: process.env.VITE_SENTRY_ORG ?? import.meta.env?.VITE_SENTRY_ORG,
    VITE_SENTRY_PROJECT: process.env.VITE_SENTRY_PROJECT ?? import.meta.env?.VITE_SENTRY_PROJECT,
  },
  emptyStringAsUndefined: true,
});
