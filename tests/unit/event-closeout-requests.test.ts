import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { render as renderEmail } from "@react-email/render";

import { cancellationRequestedSql } from "#/features/event-requests/cancellation-requests.server";
import { changeRequestsWaitingSql } from "#/features/event-requests/change-requests.server";
import {
  canRaiseEventChangeRequest,
  canRequestEventCancellation,
} from "#/features/event-requests/schema";
import { EVENT_CANCELLED_CLOSEOUT_REASON } from "#/features/events/cancellation";
import {
  EVENT_COMPLETED_CLOSEOUT_REASON,
  closeOutProcessorName,
  completionRefusal,
} from "#/features/events/completion";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";

vi.mock("#/env", () => ({ env: { BETTER_AUTH_URL: "http://localhost:3000" } }));

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

  it("renders the close-out copy end to end from the stored payload", async () => {
    const parsed = parseNotificationPayload("event_cancellation_declined", {
      eventName: "Gala",
      reason: EVENT_COMPLETED_CLOSEOUT_REASON,
      closeOut: true,
      eventStatus: "completed",
    });
    if (!parsed) throw new Error("Expected the cancellation decline notice to parse");
    const rendered = renderNotificationEmail({ ...parsed, eventRequestId: 7 });
    expect(rendered.subject).toBe("Cancellation request closed: Gala");
    const html = await renderEmail(rendered.element);
    expect(html).toContain("Cancellation request closed");
    expect(html).toContain("was closed");
    expect(html).toContain("already taken place");
    expect(html).not.toContain("declined");
    expect(html).not.toContain("goes ahead");
  });

  it("renders a manual decline that reuses the close-out reason as a normal decline", async () => {
    const parsed = parseNotificationPayload("event_cancellation_declined", {
      eventName: "Gala",
      reason: EVENT_COMPLETED_CLOSEOUT_REASON,
      eventStatus: "confirmed",
    });
    if (!parsed) throw new Error("Expected the manual decline notice to parse");
    const rendered = renderNotificationEmail({ ...parsed, eventRequestId: 7 });
    expect(rendered.subject).toBe("Cancellation request declined: Gala");
    const html = await renderEmail(rendered.element);
    expect(html).toContain("The event goes ahead.");
    expect(html).not.toContain("already taken place");
  });

  it("keeps a manual decline summary while a close-out gets its own, and old rows still parse", () => {
    const manual = parseNotificationPayload("event_cancellation_declined", {
      eventName: "Gala",
      reason: "The deposit is paid.",
      eventStatus: "confirmed",
    });
    if (!manual) throw new Error("Expected the manual decline notice to parse");
    expect(notificationSummary(manual)).toBe("Cancellation request declined: Gala");

    // Rows stored before the flag and status existed carry neither, and still parse as declines.
    const legacy = parseNotificationPayload("event_cancellation_declined", {
      eventName: "Gala",
      reason: "The deposit is paid.",
    });
    if (!legacy) throw new Error("Expected the legacy decline notice to parse");
    expect(notificationSummary(legacy)).toBe("Cancellation request declined: Gala");
  });

  it("records the acting Coordinator as processor, falling back to the email (AC3)", () => {
    expect(closeOutProcessorName({ name: "Cancel Coordinator", email: "coord@x.test" })).toBe(
      "Cancel Coordinator"
    );
    expect(closeOutProcessorName({ name: "  Padded Name  ", email: "coord@x.test" })).toBe(
      "Padded Name"
    );
    // The processor columns refuse blank text, so a missing name uses the email instead.
    for (const name of [null, undefined, "", "   "]) {
      expect(closeOutProcessorName({ name, email: "coord@x.test" })).toBe("coord@x.test");
    }
  });

  it("lets a rejected event be cancelled, while draft, completed and cancelled stay closed (AC5)", () => {
    expect(canRequestEventCancellation("rejected")).toBe(true);
    expect(canRaiseEventChangeRequest("rejected")).toBe(true);
    for (const status of ["draft", "completed", "cancelled"] as const) {
      expect(canRequestEventCancellation(status)).toBe(false);
      expect(canRaiseEventChangeRequest(status)).toBe(false);
    }
  });

  it("closes nothing on rejection alone: a rejected event still refuses completion (AC5)", () => {
    expect(completionRefusal({ status: "rejected", eventHasEnded: true })).not.toBeNull();
  });

  it("counts only requests with no outcome as waiting in the queue (AC4)", () => {
    // Both queue predicates read the same rule: a decided row (declined included) is not waiting.
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(changeRequestsWaitingSql()).sql).toContain('"outcome" is null');
    expect(dialect.sqlToQuery(cancellationRequestedSql()).sql).toContain('"outcome" is null');
  });
});
