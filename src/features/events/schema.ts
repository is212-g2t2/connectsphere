import { z } from "zod";

/**
 * `event_requests.id` is int4, so an id past that range would reach the `where` clause and have
 * Postgres answer 22003 instead of "no such event" (the reason `parseEventRequestId` is `int32`).
 * An invalid or out-of-range id is a validation refusal, never a query.
 */
const EVENT_LIST_ID_MESSAGE = "Choose an event";

const EventListInput = z
  .object({
    eventId: z.int32({ error: EVENT_LIST_ID_MESSAGE }).positive(EVENT_LIST_ID_MESSAGE).optional(),
  })
  .default({});

type EventListValues = z.infer<typeof EventListInput>;

export function parseEventListInput(data: unknown): EventListValues {
  const parsed = EventListInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}
