import { z } from "zod";

/**
 * `event_requests.id` is int4, so an id past that range would reach the `where` clause and have
 * Postgres answer 22003 instead of "no such event" (the reason `parseEventRequestId` is `int32`).
 * An invalid or out-of-range id is a validation refusal, never a query.
 */
const EVENT_LIST_ID_MESSAGE = "Choose an event";

export const EventId = z.int32({ error: EVENT_LIST_ID_MESSAGE }).positive(EVENT_LIST_ID_MESSAGE);

const EventListInput = z.object({ eventId: EventId.optional() }).default({});

type EventListValues = z.infer<typeof EventListInput>;

export function parseEventListInput(data: unknown): EventListValues {
  const parsed = EventListInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export const VIP_EMAIL_MESSAGE = "Enter the Attendee's email address";

/**
 * PTR-111: the event, and the Attendee account that the VIP registration is for, named by its
 * email. Better Auth stores emails in lower case, so the input is trimmed and lowered to match.
 */
export const VipRegistrationInput = z.object({
  id: EventId,
  email: z
    .string({ error: VIP_EMAIL_MESSAGE })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: VIP_EMAIL_MESSAGE })),
});

export function parseVipRegistrationInput(data: unknown): z.infer<typeof VipRegistrationInput> {
  const parsed = VipRegistrationInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

const VIP_REMOVAL_MESSAGE = "Choose a VIP registration";

/** PTR-111 AC6: the event, and the Attendee whose VIP registration is removed. */
const VipRemovalInput = z.object({
  id: EventId,
  attendeeId: z.string({ error: VIP_REMOVAL_MESSAGE }).min(1, VIP_REMOVAL_MESSAGE),
});

export function parseVipRemovalInput(data: unknown): z.infer<typeof VipRemovalInput> {
  const parsed = VipRemovalInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}
