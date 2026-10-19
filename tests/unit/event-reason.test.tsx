import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { EventCancelledEmail } from "#/features/emails/components/event-cancellation-email";
import { EventChangeProcessedEmail } from "#/features/emails/components/event-change-request-email";
import { EventSignificantChangeEmail } from "#/features/emails/components/event-significant-change-email";
import {
  parseEventCancellationInput,
  parseEventInformationInput,
} from "#/features/event-requests/schema";
import {
  notificationHref,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";

describe("cancellation and significant-change reasons (PTR-164)", () => {
  it("requires a reason to cancel (AC1)", () => {
    expect(parseEventCancellationInput({ id: 7, reason: "  Venue closed. " })).toEqual({
      id: 7,
      reason: "Venue closed.",
    });
    expect(() => parseEventCancellationInput({ id: 7 })).toThrow("Enter a reason for cancelling");
    expect(() => parseEventCancellationInput({ id: 7, reason: "   " })).toThrow(
      "Enter a reason for cancelling"
    );
  });

  it("accepts a reason on an event information save (AC2)", () => {
    const parsed = parseEventInformationInput({
      id: 7,
      amendments: { purpose: "New purpose" },
      acknowledgeSignificant: true,
      reason: "The organiser confirmed it.",
    });
    expect(parsed.reason).toBe("The organiser confirmed it.");
  });

  it("carries the reason on every cancellation notice, and still parses stored rows (AC1)", () => {
    for (const payload of [
      { audience: "organiser", eventName: "Gala", reason: "Venue closed." },
      { audience: "attendee", eventName: "Gala", reason: "Venue closed." },
      { audience: "technical_support", eventName: "Gala", reason: "Venue closed." },
      {
        audience: "venue_staff",
        venueName: "Harbour Hall",
        startsAt: "2026-10-12 14:00:00",
        endsAt: "2026-10-12 17:00:00",
        reason: "Venue closed.",
      },
    ] as const) {
      const parsed = parseNotificationPayload("event_cancelled", payload);
      if (!parsed) throw new Error("cancellation notice did not parse");
      expect(parsed.payload).toMatchObject({ reason: "Venue closed." });
    }
    // Rows stored before this story carry no reason and still parse.
    expect(
      parseNotificationPayload("event_cancelled", { audience: "organiser", eventName: "Gala" })
    ).not.toBeNull();
  });

  it("tells the Organiser of a significant change too, with the reason (AC3)", () => {
    const organiser = parseNotificationPayload("event_significant_change", {
      audience: "organiser",
      eventName: "Gala",
      changedFields: ["proposedDates"],
      actorName: "Alex",
      reason: "The organiser confirmed the new date.",
    });
    if (!organiser) throw new Error("organiser notice did not parse");
    expect(notificationSummary(organiser)).toBe("Event details changed: Gala");
    expect(notificationHref({ ...organiser, eventRequestId: 7 })).toBe("/events/7");
    // Staff copies carry the reason as well, and old rows still parse.
    const staff = parseNotificationPayload("event_significant_change", {
      audience: "technical_support",
      eventName: "Gala",
      changedFields: ["proposedDates"],
      actorName: "Alex",
    });
    expect(staff).not.toBeNull();
  });

  it("carries the reason on an applied change request instead of a second notice (AC3)", () => {
    const applied = parseNotificationPayload("event_change_processed", {
      outcome: "applied",
      eventName: "Gala",
      whatShouldChange: "Date",
      reason: "The organiser confirmed the new date.",
    });
    if (!applied) throw new Error("applied notice did not parse");
    expect(applied.payload).toMatchObject({ reason: "The organiser confirmed the new date." });
    expect(
      parseNotificationPayload("event_change_processed", {
        outcome: "applied",
        eventName: "Gala",
        whatShouldChange: "Date",
      })
    ).not.toBeNull();
  });

  it("renders the reason in the cancellation, significant-change and applied emails", async () => {
    const cancelled = await render(
      <EventCancelledEmail
        audience="organiser"
        eventName="Community workshop"
        reason="The venue closed for repairs."
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(cancelled).toContain("Reason:");
    expect(cancelled).toContain("The venue closed for repairs.");

    const changed = await render(
      <EventSignificantChangeEmail
        audience="organiser"
        eventName="Community workshop"
        changedFields={["proposedDates"]}
        actorName="Alex Tan"
        reason="The organiser confirmed the new date."
        arrangementUrl="http://localhost:3000/events/42"
      />
    );
    expect(changed).toContain("Reason:");
    expect(changed).toContain("The organiser confirmed the new date.");

    const applied = await render(
      <EventChangeProcessedEmail
        outcome="applied"
        eventName="Community workshop"
        whatShouldChange="Expected attendance"
        reason="The organiser confirmed the new attendance."
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );
    expect(applied).toContain("Reason:");
    expect(applied).toContain("The organiser confirmed the new attendance.");
    expect(applied).toContain("now shows the new information");
  });
});
