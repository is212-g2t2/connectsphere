import { describe, expect, it } from "vitest";

import { canReadEventAttachments } from "#/features/event-requests/attachments";
import {
  eventAttachmentDownloadUrl,
  eventAttachmentSections,
} from "#/features/events/components/event-attachments";
import type { EventProjection } from "#/features/events/access";
import type { EventPageData } from "#/features/events/page-data";

const base = {
  userId: "reader-1",
  organiserId: "organiser-1",
  assignedCoordinatorId: "coordinator-1",
  status: "submitted" as const,
  hasSafetyReview: false,
};

describe("canReadEventAttachments", () => {
  it.each([
    ["the owning organiser", { ...base, role: "event_organiser", userId: "organiser-1" }],
    ["the assigned coordinator", { ...base, role: "event_coordinator", userId: "coordinator-1" }],
    ["a lead on a non-draft event", { ...base, role: "event_coordinator_lead" }],
    [
      "a safety officer reviewing the event",
      { ...base, role: "safety_officer", hasSafetyReview: true },
    ],
  ])("allows %s", (_name, reader) => {
    expect(canReadEventAttachments(reader)).toBe(true);
  });

  it.each([
    ["an attendee", { ...base, role: "attendee" }],
    ["venue staff with an arrangement", { ...base, role: "venue_staff" }],
    ["technical support with an arrangement", { ...base, role: "technical_support_staff" }],
    ["another organiser", { ...base, role: "event_organiser", userId: "organiser-2" }],
    ["an unassigned coordinator", { ...base, role: "event_coordinator", userId: "coordinator-2" }],
    ["a lead on a draft", { ...base, role: "event_coordinator_lead", status: "draft" as const }],
    [
      "a safety officer with no review",
      { ...base, role: "safety_officer", hasSafetyReview: false },
    ],
    [
      "a safety officer on a draft with a review",
      { ...base, role: "safety_officer", status: "draft" as const, hasSafetyReview: true },
    ],
    ["an unknown role", { ...base, role: "visitor" }],
    ["a missing role", { ...base, role: null }],
  ])("refuses %s", (_name, reader) => {
    expect(canReadEventAttachments(reader)).toBe(false);
  });
});

function projection(access: EventProjection["access"]): EventProjection {
  return {
    access,
    event: { id: 1042, eventDate: null, startTime: null, endTime: null, status: "submitted" },
  };
}

function sectionIds(data: EventPageData): string[] {
  return eventAttachmentSections(data).map(section => section.id);
}

describe("eventAttachmentSections", () => {
  it.each(["organiser", "coordinator", "lead", "safety_officer"] as const)(
    "shows the supporting documents to the %s",
    access => {
      expect(sectionIds({ kind: "event", event: projection(access) })).toEqual(["attachments"]);
    }
  );

  it.each(["attendee", "venue_staff", "technical_support"] as const)(
    "shows no supporting documents to %s",
    access => {
      expect(sectionIds({ kind: "event", event: projection(access) })).toEqual([]);
    }
  );

  it("shows the supporting documents on the lead's unassigned detail", () => {
    const data = {
      kind: "triage",
      request: { id: 1042, status: "submitted" },
      coordinators: [],
    } as unknown as EventPageData;
    expect(sectionIds(data)).toEqual(["attachments"]);
  });
});

describe("eventAttachmentDownloadUrl", () => {
  it("points at the download route with both ids", () => {
    expect(eventAttachmentDownloadUrl(41, 7)).toBe("/api/event-attachments?id=41&attachmentId=7");
  });
});
