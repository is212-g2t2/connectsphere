import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CoordinationRequest } from "#/features/coordination/server-fns";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";

const { requestEventCancellation, invalidate, success } = vi.hoisted(() => ({
  requestEventCancellation: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  raiseEventChangeRequest: vi.fn<() => Promise<never>>(),
  requestEventCancellation,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

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
    expect(within(history).getByText(/Waiting for the Coordinator/)).toBeTruthy();
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
      expect(success).toHaveBeenCalledWith(
        "Cancellation requested. The Coordinator will process it."
      );
      expect(invalidate).toHaveBeenCalled();
    });
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
