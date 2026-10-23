// oxlint-disable node/no-process-env

import { E2E_BASE_URL } from "./base-url";

/** PTR-55: drain the notification email queue through the token-guarded route that Cloud Scheduler
 * calls every minute. E2E tests request delivery before polling Mailpit, so they do not need a
 * running scheduler.
 */
export async function deliverQueuedEmails(): Promise<void> {
  const token = process.env.CRON_TOKEN ?? "e2e-cron-token";
  const response = await fetch(`${E2E_BASE_URL}/api/cron/notifications`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Notification delivery failed with status ${response.status}`);
  }
}
