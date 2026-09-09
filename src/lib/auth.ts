import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createElement } from "react";
import { z } from "zod";

import { db } from "#/db";
import * as schema from "#/db/schema";
import { env } from "#/env";
import { sendEmail } from "#/lib/mailer";
import { PasswordSchema } from "#/features/auth/schema/password";
import { DEFAULT_ROLE, RoleSchema } from "#/features/auth/schema/role";
import { ResetPasswordEmail } from "#/features/emails/components/reset-password-email";
import { VerificationEmail } from "#/features/emails/components/verification-email";
import { logger } from "#/lib/logger";

/**
 * Auth endpoints that *set* a password, and so must enforce `PasswordSchema`.
 *
 * `/sign-in/email` is deliberately absent: it carries a password too, but validating there would
 * lock out any existing account whose password predates the current policy. Better Auth's
 * `setPassword` is `createAuthEndpoint.serverOnly`, so it has no route of its own to guard.
 */
const PASSWORD_SETTING_PATHS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

/** Only to pull the candidate password off an untyped request body; the policy itself is `PasswordSchema`. */
const PasswordBodySchema = z.object({
  password: z.string().optional(),
  newPassword: z.string().optional(),
});

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        // Load-bearing, not a duplicate of the column DEFAULT: Better Auth applies defaultValue
        // before its required check, so without it a sign-up omitting `role` is rejected outright
        // and the database default never gets the chance to fire.
        defaultValue: DEFAULT_ROLE,
        input: true,
        // `input: true` means the client supplies this, on /sign-up/email *and* /update-user.
        // Without a validator any string persists, letting anyone self-assign an internal role.
        validator: { input: RoleSchema },
      },
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    async sendVerificationEmail({ user, url }) {
      logger.info("Sending verification email", { email: user.email });
      await sendEmail(user.email, "Verify your email", createElement(VerificationEmail, { url }));
    },
  },

  emailAndPassword: {
    enabled: true,
    async sendResetPassword({ user, url }) {
      logger.info("Sending password reset email", { email: user.email });
      await sendEmail(
        user.email,
        "Reset your password",
        createElement(ResetPasswordEmail, { url, user: { email: user.email } })
      );
    },
  },

  // Better Auth only enforces a length range of its own, so the rest of PasswordSchema (a digit,
  // a symbol, a 128 maximum) has to be applied here or it exists only in the browser.
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (!PASSWORD_SETTING_PATHS.has(ctx.path)) {
        return;
      }
      const body = PasswordBodySchema.safeParse(ctx.body);
      const password = body.success ? (body.data.newPassword ?? body.data.password) : undefined;
      if (password === undefined) {
        return;
      }
      const result = PasswordSchema.safeParse(password);
      if (!result.success) {
        throw new APIError("BAD_REQUEST", { message: result.error.issues[0].message });
      }
    }),
  },

  rateLimit: {
    window: 60,
    max: 20,
    storage: "memory",
  },

  plugins: [tanstackStartCookies()],
});
