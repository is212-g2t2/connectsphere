import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatInstant } from "#/features/event-requests/format";
import { organiserRequestSections } from "#/features/event-requests/components/organiser-request-sections";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EventPageData } from "#/features/events/page-data";

const { invalidate, success, warning } = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  replyToClarification: vi.fn<(input: unknown) => Promise<unknown>>(),
  raiseEventChangeRequest: vi.fn<(input: unknown) => Promise<unknown>>(),
  requestEventCancellation: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, warning } }));

const base = {
  id: 1040,
  eventName: "Spring Volunteer Meetup",
  submittedAt: new Date("2026-09-20T02:00:00Z"),
  decidedAt: null,
  decidedByCoordinatorName: null,
  decisionReason: null,
  coordinator: { name: "Jonas Weber", email: "jonas@example.com" },
  purpose: "Welcome volunteers",
  proposedDates: [{ start: "2027-03-07T13:00", end: "2027-03-07T17:00" }],
  expectedAttendance: 40,
  description: "A meetup for volunteers.",
  eventType: "Volunteer meetup",
  venueRequirements: "Step-free access, PA system",
  roomLayoutPreference: "Workshop rows",
  accessibilityRequirements: "Step-free access throughout",
  equipmentRequirements: [],
  specialArrangements: "None",
  registrationEnabled: false,
  registrationCapacity: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
  clarifications: [],
  changeRequests: [],
  cancellationRequests: [],
} as unknown as EventRequestDetail;

function page(status: EventRequestStatus, request: EventRequestDetail): EventPageData {
  return {
    kind: "event",
    event: {
      access: "organiser",
      event: { id: 1040, name: "Spring Volunteer Meetup", status },
    },
    organiserRequest: request,
  } as unknown as EventPageData;
}

function renderRequests(status: EventRequestStatus, request: EventRequestDetail) {
  cleanup();
  const data = page(status, { ...request, status });
  const section = organiserRequestSections(data).find(candidate => candidate.id === "requests");
  expect(section).toBeDefined();
  render(<>{section?.render(data)}</>);
}

const openClarification = {
  id: 11,
  body: "The town hall asked whether you can bring your own projector.",
  createdAt: new Date("2026-09-21T02:00:00Z"),
  replyBody: null,
  repliedAt: null,
  amendments: [],
  permittedFields: ["description"],
} as unknown as EventRequestDetail["clarifications"][number];

describe("organiserRequestSections", () => {
  it("records the decision for a rejected request", () => {
    const decidedAt = new Date("2026-09-18T07:04:00Z");
    cleanup();
    const data = page("rejected", {
      ...base,
      status: "rejected",
      decidedAt,
      decidedByCoordinatorName: "Jonas Weber",
      decisionReason: "The main hall is already booked that weekend.",
    });
    const section = organiserRequestSections(data).find(candidate => candidate.id === "decision");
    expect(section?.label).toBe("Recorded decision");
    expect(section?.visible(data)).toBe(true);
    render(<>{section?.render(data)}</>);

    expect(screen.getByRole("heading", { name: "Recorded decision" })).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("Jonas Weber")).toBeTruthy();
    expect(screen.getByText(formatInstant(decidedAt))).toBeTruthy();
    expect(screen.getByText("The main hall is already booked that weekend.")).toBeTruthy();
  });

  it("hides the decision while the request is undecided", () => {
    const data = page("submitted", { ...base, status: "submitted" });
    const section = organiserRequestSections(data).find(candidate => candidate.id === "decision");

    expect(section?.visible(data)).toBe(false);
  });
  it("offers the reply form only while the request waits on the organiser", () => {
    renderRequests("awaiting_organiser", { ...base, clarifications: [openClarification] });
    expect(screen.getByLabelText(/Your reply/)).toBeTruthy();

    renderRequests("under_review", { ...base, clarifications: [openClarification] });
    expect(screen.getAllByLabelText(/Your reply/)).toHaveLength(1);
  });

  it("shows no reply form once the request moves past the organiser", () => {
    renderRequests("confirmed", { ...base, clarifications: [openClarification] });

    expect(screen.queryByLabelText(/Your reply/)).toBeNull();
    expect(
      screen.getByText("The town hall asked whether you can bring your own projector.")
    ).toBeTruthy();
  });

  it("gates the change form on a changeable status", () => {
    renderRequests("confirmed", base);
    expect(screen.getByRole("heading", { name: "Request a change" })).toBeTruthy();

    renderRequests("cancelled", base);
    expect(screen.queryByRole("heading", { name: "Request a change" })).toBeNull();
  });

  it("gates the cancellation action on a cancellable status with no waiting request", () => {
    renderRequests("confirmed", base);
    expect(screen.getByRole("button", { name: "Request cancellation" })).toBeTruthy();

    const waiting = {
      id: 1,
      createdAt: new Date("2026-10-01T02:00:00Z"),
      outcome: null,
      declineReason: null,
      processedByName: null,
      processedAt: null,
    } as unknown as EventRequestDetail["cancellationRequests"][number];
    renderRequests("confirmed", { ...base, cancellationRequests: [waiting] });
    expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();

    renderRequests("cancelled", base);
    expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();
  });

  it("renders the change and cancellation histories with their outcomes and reasons", () => {
    const request = {
      ...base,
      changeRequests: [
        {
          id: 3,
          createdAt: new Date("2026-09-20T02:00:00Z"),
          whatShouldChange: "Start time",
          requestedValue: "Move the start to 11:00",
        },
      ],
      cancellationRequests: [
        {
          id: 1,
          createdAt: new Date("2026-10-01T02:00:00Z"),
          outcome: "declined",
          declineReason: "The booking is already confirmed.",
          processedByName: "Jonas Weber",
          processedAt: new Date("2026-10-02T02:00:00Z"),
        },
      ],
    } as unknown as EventRequestDetail;
    renderRequests("confirmed", request);

    expect(screen.getByText("Move the start to 11:00")).toBeTruthy();
    expect(screen.getByText("The booking is already confirmed.")).toBeTruthy();
    expect(screen.getByText(/Declined by Jonas Weber/)).toBeTruthy();
  });

  it("links the coordinator contact by email", () => {
    renderRequests("confirmed", base);

    const link = screen.getByRole("link", { name: "jonas@example.com" });
    expect(link.getAttribute("href")).toBe("mailto:jonas@example.com");
    expect(screen.getByText("Jonas Weber")).toBeTruthy();
  });
});
