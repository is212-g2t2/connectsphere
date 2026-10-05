import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";

const {
  requestEventCancellation,
  cancelEvent,
  declineEventCancellation,
  invalidate,
  success,
  warning,
} = vi.hoisted(() => ({
  requestEventCancellation: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  cancelEvent: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  declineEventCancellation:
    vi.fn<(input: { data: { id: number; reason: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  raiseEventChangeRequest: vi.fn<() => Promise<never>>(),
  requestEventCancellation,
}));
vi.mock("#/features/events/server-fns", () => ({ cancelEvent, declineEventCancellation }));
vi.mock("#/features/coordination/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, warning } }));

const actor = { id: "coord-a", email: "a@example.com", name: "Alex", role: "event_coordinator" };

const request: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Annual Gala",
  status: "planning",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: new Date("2026-09-15T03:00:00Z"),
  assignedCoordinatorId: "coord-a",
  decisionReason: null,
  decidedByCoordinatorId: "coord-a",
  decidedByCoordinatorName: "Alex",
  decidedAt: new Date("2026-09-16T03:00:00Z"),
  confirmedById: null,
  confirmedByName: null,
  confirmedAt: null,
  completedById: null,
  completedByName: null,
  completedAt: null,
  cancelledById: null,
  cancelledByName: null,
  cancelledAt: null,
  purpose: "Fundraiser",
  proposedDates: [],
  expectedAttendance: 100,
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
  createdAt: new Date(),
  updatedAt: new Date(),
  organiser: { name: "Organiser", email: "org@example.com" },
  coordinator: { name: "Alex", email: "a@example.com" },
  clarifications: [],
  changeRequests: [],
  cancellationRequests: [],
  outstandingReleases: null,
  pendingHandover: null,
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
};

const waiting = {
  id: 1,
  createdAt: new Date("2026-10-01T02:00:00Z"),
  outcome: null,
  declineReason: null,
  processedByName: null,
  processedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("requesting cancellation (PTR-53)", () => {
  it("offers the Organiser the request while the event can still change (AC1, AC2)", () => {
    render(<EventRequestDetailPage request={request} showCancellationRequest />);

    expect(screen.getByRole("heading", { name: "Request cancellation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request cancellation" })).toBeTruthy();
    expect(
      screen.getByText(
        "Ask Alex to cancel this event. The event's status stays the same until Alex processes the request."
      )
    ).toBeTruthy();
  });

  it("offers no request on a page that has not opted in", () => {
    render(<EventRequestDetailPage request={request} />);

    expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();
  });

  it("says where the request goes when no Coordinator is assigned (AC3)", async () => {
    const user = userEvent.setup();
    const unassigned =
      "No Coordinator is assigned yet, so the request waits in the unassigned events list.";
    const status = "The event's status stays the same until a Coordinator processes the request.";
    render(
      <EventRequestDetailPage
        request={{ ...request, assignedCoordinatorId: null, coordinator: null }}
        showCancellationRequest
      />
    );

    expect(
      screen.getByText(`Ask for this event to be cancelled. ${unassigned} ${status}`)
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Request cancellation" }));
    const dialog = screen.getByRole("alertdialog").textContent;
    expect(dialog).toContain(`${unassigned} ${status}`);
    expect(dialog).not.toContain("Alex");
  });

  it.each(["draft", "completed", "cancelled"] as const)(
    "offers no request for a %s event (AC2)",
    status => {
      render(<EventRequestDetailPage request={{ ...request, status }} showCancellationRequest />);

      expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();
    }
  );

  it("offers no second request while one waits, and says the status is unchanged (AC4)", () => {
    render(
      <EventRequestDetailPage
        request={{ ...request, cancellationRequests: [waiting] }}
        showCancellationRequest
      />
    );

    expect(screen.queryByRole("button", { name: "Request cancellation" })).toBeNull();
    const history = screen.getByRole("region", { name: "Cancellation requests" });
    expect(
      within(history).getByText(
        "Waiting. The event's status stays the same until Alex processes the request."
      )
    ).toBeTruthy();
    expect(screen.getByText("Planning")).toBeTruthy();
  });

  it("records the request once the Organiser confirms it (AC1)", async () => {
    const user = userEvent.setup();
    requestEventCancellation.mockResolvedValueOnce({ id: 1 });
    render(<EventRequestDetailPage request={request} showCancellationRequest />);

    await user.click(screen.getByRole("button", { name: "Request cancellation" }));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(requestEventCancellation).toHaveBeenCalledWith({ data: { id: 7 } });
      expect(success).toHaveBeenCalledWith("Cancellation requested. Alex has been notified.");
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("keeps a recorded request a success when the page refresh fails", async () => {
    const user = userEvent.setup();
    requestEventCancellation.mockResolvedValueOnce({ id: 1 });
    invalidate.mockRejectedValueOnce(new Error("Network down"));
    render(<EventRequestDetailPage request={request} showCancellationRequest />);

    await user.click(screen.getByRole("button", { name: "Request cancellation" }));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(warning).toHaveBeenCalledWith(
        "Your cancellation request was saved. Refresh this page to see it."
      );
    });
    expect(success).toHaveBeenCalledWith("Cancellation requested. Alex has been notified.");
    expect(screen.queryByText("Could not request cancellation. Try again.")).toBeNull();
  });

  it("shows the server's refusal", async () => {
    const user = userEvent.setup();
    requestEventCancellation.mockRejectedValueOnce(
      new Error("This event can no longer be cancelled.")
    );
    render(<EventRequestDetailPage request={request} showCancellationRequest />);

    await user.click(screen.getByRole("button", { name: "Request cancellation" }));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This event can no longer be cancelled."
    );

    // Closing the dialog keeps the refusal on the page.
    await user.click(screen.getByRole("button", { name: "Keep event" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("This event can no longer be cancelled.")).toBeTruthy();
  });

  it("keeps each request with its outcome on the record (PTR-54 AC7, AC8)", () => {
    render(
      <EventRequestDetailPage
        request={{
          ...request,
          cancellationRequests: [
            {
              ...waiting,
              outcome: "declined",
              declineReason: "The deposit is paid.",
              processedByName: "Alex",
              processedAt: new Date("2026-10-02T02:00:00Z"),
            },
            {
              ...waiting,
              id: 2,
              outcome: "cancelled",
              processedByName: "Alex",
              processedAt: new Date("2026-10-03T02:00:00Z"),
            },
          ],
        }}
      />
    );

    const history = screen.getByRole("region", { name: "Cancellation requests" });
    expect(within(history).getByText(/Declined by Alex/)).toBeTruthy();
    expect(within(history).getByText("The deposit is paid.")).toBeTruthy();
    expect(within(history).getByText(/Event cancelled by Alex/)).toBeTruthy();
  });
});

describe("processing a cancellation request (PTR-54)", () => {
  const withWaiting = { ...request, cancellationRequests: [waiting] };

  it("offers the assigned Coordinator to cancel or decline a waiting request", () => {
    render(<CoordinationRequestPage request={withWaiting} coordinators={[]} user={actor} />);

    expect(screen.getByRole("heading", { name: "Cancellation requested" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel event" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline request" })).toBeTruthy();
  });

  it("offers nothing to a Coordinator the event is not assigned to", () => {
    render(
      <CoordinationRequestPage
        request={{ ...withWaiting, assignedCoordinatorId: "coord-b" }}
        coordinators={[]}
        user={actor}
      />
    );

    expect(screen.queryByRole("heading", { name: "Cancellation requested" })).toBeNull();
  });

  it("cancels the event once the Coordinator confirms it (AC1)", async () => {
    const user = userEvent.setup();
    cancelEvent.mockResolvedValueOnce({ outstandingReleases: null });
    render(<CoordinationRequestPage request={withWaiting} coordinators={[]} user={actor} />);

    await user.click(screen.getByRole("button", { name: "Cancel event" }));
    await user.click(screen.getByRole("button", { name: "Cancel the event" }));

    await waitFor(() => {
      expect(cancelEvent).toHaveBeenCalledWith({ data: { id: 7 } });
      expect(success).toHaveBeenCalledWith("Event cancelled. Everyone concerned will be notified.");
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("requires a reason to decline, then sends it (AC8)", async () => {
    const user = userEvent.setup();
    declineEventCancellation.mockResolvedValueOnce(undefined);
    render(<CoordinationRequestPage request={withWaiting} coordinators={[]} user={actor} />);

    await user.click(screen.getByRole("button", { name: "Decline request" }));
    expect(await screen.findByText("Enter a reason for declining")).toBeTruthy();
    expect(declineEventCancellation).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Reason for declining"), "The deposit is paid.");
    await user.click(screen.getByRole("button", { name: "Decline request" }));

    await waitFor(() => {
      expect(declineEventCancellation).toHaveBeenCalledWith({
        data: { id: 7, reason: "The deposit is paid." },
      });
      expect(success).toHaveBeenCalledWith("Cancellation request declined.");
    });
  });

  it("lists what a cancelled event still holds as outstanding releases (AC2, AC6)", () => {
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          status: "cancelled",
          cancelledById: "coord-a",
          cancelledByName: "Alex",
          cancelledAt: new Date("2026-10-03T02:00:00Z"),
          outstandingReleases: {
            venueBookings: [
              {
                id: "b1",
                venueName: "Hall A",
                startsAt: "2026-12-05 10:00:00",
                endsAt: "2026-12-05 16:00:00",
              },
            ],
            venueHolds: [
              {
                id: "h1",
                venueName: "Room B",
                startsAt: "2026-12-06 10:00:00",
                endsAt: "2026-12-06 12:00:00",
              },
            ],
            equipmentReservations: [{ id: "e1", item: "Projector", quantity: 2 }],
          },
        }}
        coordinators={[]}
        user={actor}
      />
    );

    const releases = screen.getByRole("region", { name: "Outstanding releases" });
    expect(within(releases).getByText(/Venue booking: Hall A/)).toBeTruthy();
    expect(within(releases).getByText(/Tentative hold: Room B/)).toBeTruthy();
    expect(within(releases).getByText(/Equipment reservation: Projector × 2/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel event" })).toBeNull();
  });

  it("says when a cancelled event holds nothing more", () => {
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          status: "cancelled",
          cancelledById: "coord-a",
          cancelledByName: "Alex",
          cancelledAt: new Date("2026-10-03T02:00:00Z"),
          outstandingReleases: { venueBookings: [], venueHolds: [], equipmentReservations: [] },
        }}
        coordinators={[]}
        user={actor}
      />
    );

    const releases = screen.getByRole("region", { name: "Outstanding releases" });
    expect(within(releases).getByText("Nothing is still held for this event.")).toBeTruthy();
  });
});
