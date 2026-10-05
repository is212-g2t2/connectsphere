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

const VIP_ATTENDEE_MESSAGE = "Choose an Attendee";

/**
 * PTR-111: the event, and the Attendee account whose VIP registration is added or removed. A user
 * id is a short run of letters, digits, `-` and `_`, so anything else is refused before a query
 * (Postgres rejects a NUL byte with an error that would carry the SQL back).
 */
const VipRegistrationInput = z.object({
  id: EventId,
  attendeeId: z
    .string({ error: VIP_ATTENDEE_MESSAGE })
    .regex(/^[\w-]{1,64}$/, VIP_ATTENDEE_MESSAGE),
});

export function parseVipRegistrationInput(data: unknown): z.infer<typeof VipRegistrationInput> {
  const parsed = VipRegistrationInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}

export const VIP_SEARCH_MIN_LENGTH = 2;
export const VIP_SEARCH_MAX_LENGTH = 100;
/** The most Attendee accounts one VIP search returns. */
export const VIP_SEARCH_LIMIT = 10;
export const VIP_SEARCH_MESSAGE = `Type at least ${VIP_SEARCH_MIN_LENGTH} characters of a name or email`;

/** PTR-111: the event, and part of the name or email of the Attendee to add as a VIP. */
const VipSearchInput = z.object({
  id: EventId,
  query: z
    .string({ error: VIP_SEARCH_MESSAGE })
    .trim()
    .min(VIP_SEARCH_MIN_LENGTH, VIP_SEARCH_MESSAGE)
    .max(VIP_SEARCH_MAX_LENGTH, `Search for ${VIP_SEARCH_MAX_LENGTH} characters or fewer`)
    .regex(/^\P{Cc}*$/u, "Search for printable characters only"),
});

export function parseVipSearchInput(data: unknown): z.infer<typeof VipSearchInput> {
  const parsed = VipSearchInput.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0].message);
  }
  return parsed.data;
}
