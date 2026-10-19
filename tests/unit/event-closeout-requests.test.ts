import { describe, expect, it } from "vitest";

import { EVENT_CANCELLED_CLOSEOUT_REASON } from "#/features/events/cancellation";
import { EVENT_COMPLETED_CLOSEOUT_REASON } from "#/features/events/completion";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";

/** The close-out writes the reason into a `decline_reason` column. The CHECK refuses blank text. */
function satisfiesDeclineReasonCheck(reason: string): boolean {
  // Mirrors the Postgres `~ '[^[:space:]]'` predicate: some character is not whitespace.
  // (`\S` spells it here because this engine parses the POSIX class differently.)
  return /\S/.test(reason);
}

describe("event close-out request reasons (PTR-156)", () => {
  it("closes waiting requests with the event's end named", () => {
    expect(EVENT_CANCELLED_CLOSEOUT_REASON).toBe("Event cancelled");
    expect(EVENT_COMPLETED_CLOSEOUT_REASON).toBe("Event completed");
  });

  it("passes the decline-reason CHECK both tables enforce", () => {
    expect(satisfiesDeclineReasonCheck(EVENT_CANCELLED_CLOSEOUT_REASON)).toBe(true);
    expect(satisfiesDeclineReasonCheck(EVENT_COMPLETED_CLOSEOUT_REASON)).toBe(true);
  });

  it("sends the existing change-request decline notice for each closed change request", () => {
    for (const reason of [EVENT_CANCELLED_CLOSEOUT_REASON, EVENT_COMPLETED_CLOSEOUT_REASON]) {
      const parsed = parseNotificationPayload("event_change_processed", {
        outcome: "declined",
        eventName: "Gala",
        whatShouldChange: "Date",
        reason,
      });
      if (!parsed) throw new Error(`Expected the decline notice to parse for "${reason}"`);
      expect(notificationSummary(parsed)).toBe("Change request declined: Gala");
    }
  });

  it("sends the existing cancellation decline notice for a close-out at completion", () => {
    const parsed = parseNotificationPayload("event_cancellation_declined", {
      eventName: "Gala",
      reason: EVENT_COMPLETED_CLOSEOUT_REASON,
    });
    if (!parsed) throw new Error("Expected the cancellation decline notice to parse");
    expect(notificationSummary(parsed)).toBe("Cancellation request declined: Gala");
  });
});
