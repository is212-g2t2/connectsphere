// oxlint-disable node/no-process-env

/**
 * PTR-55: drains the notification email queue through the same token-guarded route Cloud
 * Scheduler calls every minute. E2E asks for delivery explicitly just before it waits on Mailpit,
 * so the tests stay deterministic without a scheduler running.
 */
export async function deliverQueuedEmails(): Promise<void> {
  const token = process.env.CRON_TOKEN ?? "e2e-cron-token";
  const response = await fetch("http://localhost:3000/api/cron/notifications", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Notification delivery failed with status ${response.status}`);
  }
}
