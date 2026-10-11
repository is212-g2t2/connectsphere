import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createElement } from "react";
import { z } from "zod";

import { db } from "#/db";
import * as schema from "#/db/schema";
import { env } from "#/env";
import { sendEmail } from "#/lib/mailer.server";
import { PasswordSchema } from "#/features/auth/schema/password";
import { DEFAULT_ROLE, SelfAssignableRoleSchema } from "#/features/auth/schema/role";
import { ResetPasswordEmail } from "#/features/emails/components/reset-password-email";
import { VerificationEmail } from "#/features/emails/components/verification-email";
import { logger } from "#/lib/logger";
import { maskEmail } from "#/lib/utils";

const log = logger.getChild("auth");

/**
 * List auth endpoints that set a password and must enforce `PasswordSchema`.
 *
 * Do not include `/sign-in/email`. It receives a password, but validation could lock out accounts
 * that use the old policy. Better Auth's `setPassword` uses `createAuthEndpoint.serverOnly`, so it
 * has no separate route to guard.
 */
const PASSWORD_SETTING_PATHS = new Set(["/sign-up/email", "/reset-password", "/change-password"]);

/** Read a password from an untyped request body. `PasswordSchema` defines its policy. */
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
        // Better Auth applies `defaultValue` before its required check. Set this default here or
        // sign-up rejects a missing `role` before the database can apply its column default.
        defaultValue: DEFAULT_ROLE,
        input: true,
        // `input: true` lets the client send this field to `/sign-up/email` and `/update-user`.
        // Validate it so users cannot assign themselves an internal role. Use the self-assignable
        // subset, not all of `RoleSchema`, because new users can choose only those roles.
        validator: { input: SelfAssignableRoleSchema },
      },
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    async sendVerificationEmail({ user, url }) {
      log.info("Sending verification email", { email: maskEmail(user.email) });
      await sendEmail(user.email, "Verify your email", createElement(VerificationEmail, { url }));
    },
  },

  emailAndPassword: {
    enabled: true,
    async sendResetPassword({ user, url }) {
      log.info("Sending password reset email", { email: maskEmail(user.email) });
      await sendEmail(
        user.email,
        "Reset your password",
        createElement(ResetPasswordEmail, { url, user: { email: user.email } })
      );
    },
  },

  // Better Auth enforces only its own length range. Apply the rest of `PasswordSchema` here too:
  // require a digit and symbol, and limit passwords to 128 characters.
  hooks: {
    before: createAuthMiddleware(async ctx => {
      // `/update-user` accepts `role` because the field is `input: true`. Its validator rejects
      // internal roles, but it would allow an attendee to become an `event_organiser`. Reject the
      // field here so users cannot change their own role (PTR-7).
      if (ctx.path === "/update-user") {
        if (ctx.body !== null && typeof ctx.body === "object" && "role" in ctx.body) {
          throw new APIError("FORBIDDEN", { message: "Your role cannot be changed here." });
        }
        return;
      }
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
