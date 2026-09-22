import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import {
  ASSIGNED_ON_SUBMIT,
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
    <a href={params ? to.replace("$requestId", params.requestId).replace("$id", params.id) : to}>
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
  coordinator: null,
  clarifications: [],
  eventName: "",
  purpose: "",
  proposedDates: [],
  expectedAttendance: null,
  description: "",
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
      "/event-requests/42"
    );
    expect(within(rows[0]).getByText("1 Dec 2030, 18:00")).toBeTruthy();
    expect(within(rows[0]).getByText("Submitted")).toBeTruthy();

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

describe("EventRequestDetailPage (PTR-14 AC4)", () => {
  it("shows every recorded field of a submitted request, read-only", () => {
    render(<EventRequestDetailPage request={submitted} />);

    expect(screen.getByRole("heading", { name: "Annual dinner" })).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
    // 10:00 UTC is 18:00 in Singapore; a zone-dependent render would fail on any other machine.
    expect(screen.getByText("14 Sept 2026, 18:00").tagName).toBe("TIME");
    for (const text of [
      "Thank the volunteers",
      "1 Dec 2030, 18:00 – 22:00",
      "120",
      "Dinner",
      "Near MRT",
      "Banquet",
      "Step-free access",
      "Vegetarian option",
      "Wireless microphone × 2",
      "Capacity 100",
      "Seeded Event Coordinator",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // PTR-15 criterion 3: the contact route, not only the name.
    expect(
      screen.getByRole("link", { name: "coordinator.seed@example.com" }).getAttribute("href")
    ).toBe("mailto:coordinator.seed@example.com");
    expect(screen.getByText(/Opens 1 Nov 2030, 09:00, closes 20 Nov 2030, 17:00/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a bare draft with its gaps named rather than blank", () => {
    render(<EventRequestDetailPage request={base} />);

    expect(screen.getByRole("heading", { name: UNTITLED_REQUEST })).toBeTruthy();
    expect(screen.getByText(/Saved as a draft/)).toBeTruthy();
    expect(screen.getAllByText("None recorded").length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText("Not required")).toBeTruthy();
    expect(screen.getByText(ASSIGNED_ON_SUBMIT)).toBeTruthy();
  });

  it("shows a recorded decision, reason, Coordinator and time (PTR-20 AC3)", () => {
    render(
      <EventRequestDetailPage
        request={{
          ...submitted,
          status: "rejected",
          decisionReason: "The requested room is unavailable.",
          decidedByCoordinatorId: "seed-coordinator-1",
          decidedByCoordinatorName: "Seeded Event Coordinator",
          decidedAt: new Date("2026-09-16T03:30:00Z"),
        }}
      />
    );

    const decisionCard = screen
      .getByRole("heading", { name: "Recorded decision" })
      .closest('[data-slot="card"]');
    expect(decisionCard).toBeTruthy();
    const decision = within(decisionCard as HTMLElement);
    expect(decision.getByText("Rejected")).toBeTruthy();
    expect(decision.getByText("The requested room is unavailable.")).toBeTruthy();
    expect(decision.getByText("Seeded Event Coordinator")).toBeTruthy();
    expect(decision.getByText("16 Sept 2026, 11:30").tagName).toBe("TIME");
  });
});
