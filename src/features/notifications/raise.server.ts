import type { db as Db } from "#/db";
import { notifications } from "#/db/schema";
import type { NotificationKind, NotificationPayloads } from "#/features/notifications/message";

type Database = typeof Db;

/**
 * One notification to raise, correlated so a kind cannot carry another kind's payload.
 */
export type NewNotification = {
  [K in NotificationKind]: {
    recipientId: string;
    eventRequestId: number;
    kind: K;
    payload: NotificationPayloads[K];
  };
}[NotificationKind];

/**
 * PTR-55: writes the notification rows for one state change. Called inside the handler's existing
 * transaction, so a rolled-back change raises nothing and a committed one always has its rows —
 * the property the async email queue relies on. Delivery is the worker's job; this function never
 * talks to the mail provider.
 */
export async function raiseNotifications(
  database: Pick<Database, "insert">,
  rows: readonly NewNotification[]
): Promise<void> {
  if (rows.length === 0) return;
  await database.insert(notifications).values([...rows]);
}
