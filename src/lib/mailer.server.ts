import { Resend } from "resend";
import * as React from "react";
import { logger } from "#/lib/logger";
import { maskEmail } from "#/lib/utils";
import { env } from "#/env";

const log = logger.getChild("mail");

export function createMailer(apiKey: string | undefined): Resend | null {
  if (!apiKey) return null;
  return new Resend(apiKey);
}

let cachedApiKey: string | undefined;
let cachedMailer: Resend | null = null;

export function getMailer(): Resend | null {
  if (cachedMailer && cachedApiKey === env.RESEND_API_KEY) {
    return cachedMailer;
  }
  cachedApiKey = env.RESEND_API_KEY;
  cachedMailer = createMailer(env.RESEND_API_KEY);
  return cachedMailer;
}

export async function sendEmail(to: string, subject: string, react: React.ReactElement) {
  const client = getMailer();

  if (!client) {
    throw new Error(
      "RESEND_API_KEY is not configured. Set it in your environment to enable email sending."
    );
  }

  const maskedTo = maskEmail(to);

  log.info("Sending email", { to: maskedTo, subject });

  const from = env.EMAIL_FROM ?? "ConnectSphere <onboarding@resend.dev>";

  const { data, error } = await client.emails.send({
    from,
    to,
    subject,
    react,
  });

  if (error) {
    // Resend's message can echo the recipient address, so only the error's
    // stable identifiers are logged; the thrown error keeps the full payload
    // for Sentry.
    log.error("Failed to send email", {
      to: maskedTo,
      name: error.name,
      statusCode: error.statusCode,
    });
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  log.info("Successfully sent email", { to: maskedTo, id: data.id });
  return data;
}
