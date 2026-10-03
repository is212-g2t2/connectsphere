import { z } from "zod";

const NOTIFICATION_ID_MESSAGE = "Choose a notification";
// `notifications.id` is serial (int4): a larger id would reach the `where` clause and fail there.
const notificationId = z
  .int32({ error: NOTIFICATION_ID_MESSAGE })
  .positive(NOTIFICATION_ID_MESSAGE);

/**
 * PTR-56: mark one notification read (`id`), or every one up to the highest id the page showed
 * (`throughId`). Strict, so a payload carrying both keys is refused instead of quietly taking one.
 */
const strict = { error: NOTIFICATION_ID_MESSAGE };
const MarkNotificationsReadInput = z.union(
  [
    z.strictObject({ id: notificationId }, strict),
    z.strictObject({ throughId: notificationId }, strict),
  ],
  strict
);

export type MarkNotificationsReadValues = z.infer<typeof MarkNotificationsReadInput>;

export function parseMarkNotificationsReadInput(input: unknown): MarkNotificationsReadValues {
  const parsed = MarkNotificationsReadInput.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
