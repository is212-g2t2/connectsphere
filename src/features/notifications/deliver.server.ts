import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { db as Db } from "#/db";
import { notifications, user } from "#/db/schema";
import { parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { logger } from "#/lib/logger";
import { sendEmail } from "#/lib/mailer.server";

type Database = typeof Db;

const log = logger.getChild("notifications");

/** Rows claimed per run; the next tick picks up whatever is left. */
const NOTIFICATION_BATCH_SIZE = 50;
/** Attempts before a row is dead-lettered (`failed_at`), keeping it visible in the inbox. */
export const NOTIFICATION_MAX_ATTEMPTS = 10;

export interface DeliveryResult {
  sent: number;
  failed: number;
  /** Un-emailed, un-failed rows still on the queue after this run. */
  pending: number;
}

/** 1, 2, 4, ... capped at 30 minutes, so a provider outage does not burn the attempt budget. */
function notificationRetryMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), 30);
}

/**
 * PTR-55: delivers one batch of pending notification emails.
 *
 * The claim is a single statement — an `UPDATE` over a `FOR UPDATE SKIP LOCKED` subquery — with a
 * lease (`claimed_at`) and an eligibility timestamp (`next_attempt_at`). That combination is what
 * keeps two overlapping runs from claiming the same row once the claim commits, and it is why the
 * send itself can happen outside a transaction without holding a database connection open across
 * an HTTP call. Delivery is at-least-once: a crash between send and mark re-sends on the next
 * tick, which is why the provider is given the notification id as an idempotency key. The
 * claim's `email_attempts` doubles as an ownership version on the terminal writes, so a send
 * that outlives its lease cannot clear a successor's claim.
 *
 * Every timestamp comparison and write runs on the database clock, so a row inserted a
 * millisecond before the claim is still due, and a worker on a drifting host cannot stretch or
 * skip a backoff window.
 *
 * Failures increment `email_attempts` at claim time, then either back off or, past the attempt
 * budget, dead-letter with `failed_at` and a sanitised error name (never the provider message,
 * which can echo the recipient address).
 */
export async function deliverPendingNotifications(database: Database): Promise<DeliveryResult> {
  const candidates = database
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        isNull(notifications.emailedAt),
        isNull(notifications.failedAt),
        sql`${notifications.nextAttemptAt} <= now()`,
        or(
          isNull(notifications.claimedAt),
          sql`${notifications.claimedAt} < now() - interval '10 minutes'`
        )
      )
    )
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .limit(NOTIFICATION_BATCH_SIZE)
    .for("update", { skipLocked: true });

  const claimed = await database
    .update(notifications)
    .set({ claimedAt: sql`now()`, emailAttempts: sql`${notifications.emailAttempts} + 1` })
    .where(inArray(notifications.id, candidates))
    .returning({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      recipientId: notifications.recipientId,
      eventRequestId: notifications.eventRequestId,
      emailAttempts: notifications.emailAttempts,
    });

  let sent = 0;
  let failed = 0;

  if (claimed.length > 0) {
    const recipientIds = [...new Set(claimed.map(row => row.recipientId))];
    const recipients = await database
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, recipientIds));
    const emailsById = new Map(recipients.map(row => [row.id, row.email]));

    // Sequential on purpose: a slow provider should slow this run down rather than fan out fifty
    // concurrent sends, so this file's batch loop awaits each row in turn.
    // oxlint-disable eslint/no-await-in-loop
    for (const row of claimed) {
      const email = emailsById.get(row.recipientId);
      const parsed = email ? parseNotificationPayload(row.kind, row.payload) : null;
      if (!email || !parsed) {
        // No renderer will ever understand this row, so it is dead on arrival rather than
        // retried against a schema that cannot match. A missing recipient (the account was
        // deleted between claim and send) is named apart from a payload bug.
        const released = await releaseFailed(
          database,
          row,
          parsed ? "RecipientMissing" : "UnreadableNotification",
          true
        );
        if (released) failed += 1;
        continue;
      }

      try {
        const { subject, element } = renderNotificationEmail({
          ...parsed,
          eventRequestId: row.eventRequestId,
        });
        await sendEmail(email, subject, element, { idempotencyKey: `notification-${row.id}` });
        const marked = await database
          .update(notifications)
          .set({ emailedAt: sql`now()`, claimedAt: null, lastEmailError: null })
          .where(
            and(eq(notifications.id, row.id), eq(notifications.emailAttempts, row.emailAttempts))
          )
          .returning({ id: notifications.id });
        if (marked.length === 0) {
          log.warn("Notification claim was taken over; skipping write", {
            notificationId: row.id,
          });
          continue;
        }
        sent += 1;
      } catch (error) {
        const released = await releaseFailed(
          database,
          row,
          error instanceof Error ? error.name : "UnknownError"
        );
        if (released) failed += 1;
      }
    }
  }

  const [pendingRow] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(isNull(notifications.emailedAt), isNull(notifications.failedAt)));

  return { sent, failed, pending: pendingRow.count };
}

/** Clears the claim and either backs the row off or dead-letters it once the budget is spent. Returns false when the claim was taken over and nothing was written. */
async function releaseFailed(
  database: Database,
  row: { id: number; kind: string; emailAttempts: number },
  errorName: string,
  forceTerminal = false
): Promise<boolean> {
  const terminal = forceTerminal || row.emailAttempts >= NOTIFICATION_MAX_ATTEMPTS;
  const matched = await database
    .update(notifications)
    .set({
      claimedAt: null,
      lastEmailError: errorName,
      ...(terminal
        ? { failedAt: sql`now()` }
        : {
            nextAttemptAt: sql`now() + (${notificationRetryMinutes(row.emailAttempts)} * interval '1 minute')`,
          }),
    })
    .where(and(eq(notifications.id, row.id), eq(notifications.emailAttempts, row.emailAttempts)))
    .returning({ id: notifications.id });
  if (matched.length === 0) {
    log.warn("Notification claim was taken over; skipping write", { notificationId: row.id });
    return false;
  }

  const context = { notificationId: row.id, kind: row.kind, attempts: row.emailAttempts };
  if (terminal) {
    log.error("Notification email gave up after its attempt budget", {
      ...context,
      errorName,
    });
  } else {
    log.warn("Notification email failed; it will be retried", { ...context, errorName });
  }
  return true;
}
