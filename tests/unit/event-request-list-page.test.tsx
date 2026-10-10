import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EventRequestListPage,
  NOT_YET_ASSIGNED,
  UNTITLED_REQUEST,
} from "#/features/event-requests/components/request-list-page";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";

const { deleteEventRequestDraft, invalidate } = vi.hoisted(() => ({
  deleteEventRequestDraft: vi.fn<(options: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  deleteEventRequestDraft,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a
      href={
        params
          ? to
              .replace("$requestId", params.requestId)
              .replace("$id", params.id)
              .replace("$eventId", params.eventId)
          : to
      }
    >
      {children}
    </a>
  ),

  useRouter: () => ({
    navigate: vi.fn<() => void>(),
    invalidate,
  }),
}));

const base: EventRequestDetail = {
  id: 1,
  organiserId: "usr_1",
  status: "draft",
  submittedAt: null,
  assignedCoordinatorId: null,
  assignedAt: null,
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
  confirmedById: null,
  confirmedByName: null,
  confirmedAt: null,
  completedById: null,
  completedByName: null,
  completedAt: null,
  cancelledById: null,
  cancelledByName: null,
  cancelledAt: null,
  coordinator: null,
  clarifications: [],
  changeRequests: [],
  cancellationRequests: [],
  eventName: "",
  purpose: "",
  proposedDates: [],
  expectedAttendance: null,
  description: "",
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
  registrationEnabled: false,
  registrationCapacity: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

const draft: EventRequestDetail = {
  ...base,
  id: 41,
  eventName: "Community workshop",
  proposedDates: [{ start: "2030-11-18T09:30", end: "2030-11-18T12:45" }],
};

const submitted: EventRequestDetail = {
  ...base,
  id: 42,
  status: "submitted",
  submittedAt: new Date("2026-09-14T10:00:00Z"),
  assignedCoordinatorId: "seed-coordinator-1",
  assignedAt: new Date("2026-09-14T10:00:00Z"),
  coordinator: {
    name: "Seeded Event Coordinator",
    email: "coordinator.seed@example.com",
  },
  eventName: "Annual dinner",
  purpose: "Thank the volunteers",
  proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
  expectedAttendance: 120,
  eventType: "Dinner",
  venueRequirements: "Near MRT",
  roomLayoutPreference: "Banquet",
  accessibilityRequirements: "Step-free access",
  specialArrangements: "Vegetarian option",
  equipmentRequirements: [{ type: "Wireless microphone", quantity: 2 }],
  registrationEnabled: true,
  registrationCapacity: 100,
  registrationOpensAt: "2030-11-01T09:00",
  registrationClosesAt: "2030-11-20T17:00",
};

describe("EventRequestListPage (PTR-14)", () => {
  it("lists every request with its name, proposed date and status (AC1, AC2)", () => {
    render(<EventRequestListPage requests={[submitted, draft]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByRole("link", { name: "Annual dinner" }).getAttribute("href")).toBe(
      "/events/42"
    );
    expect(within(rows[0]).getByText("1 Dec 2030, 18:00")).toBeTruthy();
    expect(within(rows[0]).getByText("Submitted")).toBeTruthy();

    // A draft has no event page yet, so its name links straight to the reopen route.
    expect(
      within(rows[1]).getByRole("link", { name: "Community workshop" }).getAttribute("href")
    ).toBe("/event-requests/reopenDraft/41");

    expect(within(rows[1]).getByRole("link", { name: "Community workshop" })).toBeTruthy();
    expect(within(rows[1]).getByText("18 Nov 2030, 09:30")).toBeTruthy();
    expect(within(rows[1]).getByText("Draft")).toBeTruthy();
  });

  it("tells a draft and a submitted request apart by more than the word (AC3)", () => {
    render(<EventRequestListPage requests={[submitted, draft]} />);

    const submittedPill = screen.getByText("Submitted");
    const draftPill = screen.getByText("Draft");
    expect(submittedPill.className).not.toBe(draftPill.className);
  });

  it("names the assigned Coordinator, and says so when there is none yet (AC2, PTR-15 AC3)", () => {
    const waiting = {
      ...submitted,
      id: 43,
      assignedCoordinatorId: null,
      assignedAt: null,
      coordinator: null,
    };
    render(<EventRequestListPage requests={[submitted, waiting]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Seeded Event Coordinator")).toBeTruthy();
    expect(within(rows[1]).getByText(NOT_YET_ASSIGNED)).toBeTruthy();
  });

  it("gives an unnamed draft a title and a dash for a date it does not have yet", () => {
    render(<EventRequestListPage requests={[base]} />);

    expect(screen.getByRole("link", { name: UNTITLED_REQUEST })).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("offers a new request from the list, and an empty state before any exist", () => {
    render(<EventRequestListPage requests={[]} />);

    expect(screen.getByRole("link", { name: "New request" }).getAttribute("href")).toBe(
      "/event-requests/new"
    );
    expect(screen.getByText(/No requests yet/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("EventRequestListPage draft actions (PTR-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidate.mockResolvedValue(undefined);
  });

  it("offers Resume only on a draft, linking to the reopen route (AC1)", () => {
    render(<EventRequestListPage requests={[submitted, draft]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[1]).getByRole("link", { name: "Resume" }).getAttribute("href")).toBe(
      "/event-requests/reopenDraft/41"
    );
    expect(within(rows[0]).queryByRole("link", { name: "Resume" })).toBeNull();
    expect(within(rows[0]).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("keeps the draft and calls nothing when the delete is cancelled (AC3)", async () => {
    render(<EventRequestListPage requests={[draft]} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this draft?")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Delete this draft?")).toBeNull();
    expect(deleteEventRequestDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Resume" })).toBeTruthy();
  });

  it("deletes the draft after Confirm and refreshes the list (AC3)", async () => {
    deleteEventRequestDraft.mockResolvedValue({ id: 41 });
    render(<EventRequestListPage requests={[draft]} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(deleteEventRequestDraft).toHaveBeenCalledExactlyOnceWith({ data: { id: 41 } })
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(screen.queryByText("Delete this draft?")).toBeNull();
  });
});
