// @vitest-environment jsdom
import { render as emailRender } from "@react-email/render";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventCancelledEmail } from "#/features/emails/components/event-cancellation-email";
import { EventChangeProcessedEmail } from "#/features/emails/components/event-change-request-email";
import { EventSignificantChangeEmail } from "#/features/emails/components/event-significant-change-email";
import { InformationChangeHistory } from "#/features/event-requests/components/request-message-blocks";
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

  it("shows the reason on the Organiser's and each Attendee's notice, and still parses stored rows (AC1, AC5, AC6)", () => {
    for (const payload of [
      {
        audience: "organiser",
        eventName: "Gala",
        reason: "Venue closed.",
      },
      { audience: "attendee", eventName: "Gala", reason: "Venue closed." },
    ] as const) {
      const notice = parseNotificationPayload("event_cancelled", payload);
      if (!notice) throw new Error(`${payload.audience} notice did not parse`);
      expect(notice.payload).toMatchObject({ reason: "Venue closed." });
    }

    // Staff copies carry no reason now; rows stored before this change still parse with or
    // without one, as do Attendee rows stored without one.
    for (const payload of [
      { audience: "attendee", eventName: "Gala" },
      { audience: "technical_support", eventName: "Gala" },
      {
        audience: "venue_staff",
        venueName: "Harbour Hall",
        startsAt: "2026-10-12 14:00:00",
        endsAt: "2026-10-12 17:00:00",
      },
      {
        audience: "technical_support",
        eventName: "Gala",
        reason: "Venue closed.",
      },
      {
        audience: "venue_staff",
        venueName: "Harbour Hall",
        startsAt: "2026-10-12 14:00:00",
        endsAt: "2026-10-12 17:00:00",
        reason: "Venue closed.",
      },
    ] as const) {
      expect(parseNotificationPayload("event_cancelled", payload)).not.toBeNull();
    }
  });

  it("tells the Organiser of a significant change with the reason; staff copies carry none (AC4, AC5, AC6)", () => {
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
    // Staff copies carry no reason now, and old rows still parse with or without one.
    for (const payload of [
      {
        audience: "technical_support",
        eventName: "Gala",
        changedFields: ["proposedDates"],
        actorName: "Alex",
      },
      {
        audience: "technical_support",
        eventName: "Gala",
        changedFields: ["proposedDates"],
        actorName: "Alex",
        reason: "The organiser confirmed the new date.",
      },
    ] as const) {
      expect(parseNotificationPayload("event_significant_change", payload)).not.toBeNull();
    }
  });

  it("carries the reason on an applied change request instead of a second notice (AC4)", () => {
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

  it("renders the reason on the Organiser's and each Attendee's emails and never on staff copies (AC1, AC5)", async () => {
    const cancelled = await emailRender(
      <EventCancelledEmail
        audience="organiser"
        eventName="Community workshop"
        reason="The venue closed for repairs."
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(cancelled).toContain("Reason:");
    expect(cancelled).toContain("The venue closed for repairs.");

    const attendeeCancelled = await emailRender(
      <EventCancelledEmail
        audience="attendee"
        eventName="Community workshop"
        reason="The venue closed for repairs."
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(attendeeCancelled).toContain("Reason:");
    expect(attendeeCancelled).toContain("The venue closed for repairs.");

    const anonymous = [
      <EventCancelledEmail
        key="technical-support"
        audience="technical_support"
        eventName="Community workshop"
        reason="The venue closed for repairs."
        eventUrl="http://localhost:3000/events/42"
      />,
      <EventCancelledEmail
        key="venue-staff"
        audience="venue_staff"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:00:00"
        endsAt="2026-10-12 17:00:00"
        reason="The venue closed for repairs."
        eventUrl="http://localhost:3000/venue-bookings"
      />,
      <EventSignificantChangeEmail
        key="technical-support-change"
        audience="technical_support"
        eventName="Community workshop"
        changedFields={["proposedDates"]}
        actorName="Alex Tan"
        reason="The organiser confirmed the new date."
        arrangementUrl="http://localhost:3000/events/42"
      />,
      <EventSignificantChangeEmail
        key="venue-staff-change"
        audience="venue_staff"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:00:00"
        endsAt="2026-10-12 17:00:00"
        changedFields={["proposedDates"]}
        actorName="Alex Tan"
        reason="The organiser confirmed the new date."
        arrangementUrl="http://localhost:3000/venue-bookings"
      />,
    ];
    const rendered = await Promise.all(anonymous.map(element => emailRender(element)));
    for (const html of rendered) {
      expect(html).not.toContain("Reason:");
      expect(html).not.toContain("venue closed for repairs.");
      expect(html).not.toContain("organiser confirmed the new date.");
    }

    const changed = await emailRender(
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

    const applied = await emailRender(
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

  it("folds one save's rows into one entry with one reason block, and keeps separate saves apart (AC3)", () => {
    cleanup();
    render(
      <InformationChangeHistory
        changes={[
          {
            id: 3,
            field: "expectedAttendance",
            amendment: { from: 40, to: 120 },
            changedByName: "Alex Tan",
            changedAt: new Date("2026-10-12T02:00:00Z"),
            reason: "The organiser confirmed the new attendance.",
          },
          {
            id: 4,
            field: "purpose",
            amendment: { from: "Meetup", to: "Regional meetup" },
            changedByName: "Alex Tan",
            changedAt: new Date("2026-10-12T02:00:00Z"),
            reason: "The organiser confirmed the new attendance.",
          },
          {
            id: 5,
            field: "purpose",
            amendment: { from: "Regional meetup", to: "National meetup" },
            changedByName: "Alex Tan",
            changedAt: new Date("2026-10-13T02:00:00Z"),
            reason: "The organiser confirmed the rename.",
          },
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "Information changes" })).toBeTruthy();
    expect(screen.getByText("Expected attendance, Purpose")).toBeTruthy();
    expect(screen.getByText("Purpose")).toBeTruthy();
    // One reason block per save, not one per changed field.
    expect(screen.getAllByText("The organiser confirmed the new attendance.")).toHaveLength(1);
    expect(screen.getByText("The organiser confirmed the rename.")).toBeTruthy();
    expect(screen.getAllByText("Changed by Alex Tan")).toHaveLength(2);
    // The merged group keeps every per-field value, not only the joined label.
    expect(screen.getByText("40 → 120")).toBeTruthy();
    expect(screen.getByText("Meetup → Regional meetup")).toBeTruthy();
  });
});
