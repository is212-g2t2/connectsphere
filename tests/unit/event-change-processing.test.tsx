import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import {
  EVENT_REQUEST_STATUSES,
  canApplyEventChangeRequest,
  parseEventChangeRequestDeclineInput,
  parseEventInformationInput,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";

const { updateEventInformation, listEventArrangements, declineEventChangeRequest, invalidate } =
  vi.hoisted(() => ({
    updateEventInformation: vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<{
        changedFields: readonly string[];
        notified: number;
      }>
    >(),
    listEventArrangements: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
    declineEventChangeRequest:
      vi.fn<
        (input: { data: { id: number; changeRequestId: number; reason: string } }) => Promise<void>
      >(),
    invalidate: vi.fn<() => Promise<void>>(),
  }));
const { success, info, warning, error } = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  updateEventInformation,
  listEventArrangements,
  declineEventChangeRequest,
}));
vi.mock("#/features/event-requests/server-fns", () => ({
  raiseEventChangeRequest: vi.fn<() => Promise<never>>(),
  requestEventCancellation: vi.fn<() => Promise<never>>(),
}));
vi.mock("#/features/coordination/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ navigate: vi.fn<() => void>(), invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, info, warning, error } }));

const actor = { id: "coord-a", email: "a@example.com", name: "Alex", role: "event_coordinator" };
const coordinators = [{ id: "coord-a", name: "Alex", email: "a@example.com" }];

const waiting = {
  id: 31,
  eventRequestId: 7,
  organiserId: "org",
  whatShouldChange: "Expected attendance",
  requestedValue: "150 attendees",
  createdAt: new Date("2026-09-17T02:00:00Z"),
  outcome: null,
  declineReason: null,
  processedById: null,
  processedByName: null,
  processedAt: null,
};
const applied = {
  ...waiting,
  id: 32,
  whatShouldChange: "Event name",
  requestedValue: "Annual Gala Dinner",
  outcome: "applied" as const,
  processedById: "coord-a",
  processedByName: "Alex",
  processedAt: new Date("2026-09-18T02:00:00Z"),
};
const declined = {
  ...applied,
  id: 33,
  whatShouldChange: "Venue",
  requestedValue: "Harbour Hall",
  outcome: "declined" as const,
  declineReason: "Harbour Hall holds 80 at most.",
};

const request: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Annual Gala",
  status: "approved",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: new Date("2026-09-15T03:00:00Z"),
  assignedCoordinatorId: "coord-a",
  decisionReason: null,
  decidedByCoordinatorId: "coord-a",
  decidedByCoordinatorName: "Alex",
  decidedAt: new Date("2026-09-16T02:00:00Z"),
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
  proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
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
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-16T02:00:00Z"),
  organiser: { name: "Organiser", email: "org@example.com" },
  coordinator: { name: "Alex", email: "a@example.com" },
  clarifications: [],
  changeRequests: [waiting],
  cancellationRequests: [],
  outstandingReleases: null,
  pendingHandover: null,
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
};

function renderPage(overrides: Partial<CoordinationRequest> = {}) {
  return render(
    <CoordinationRequestPage
      request={{ ...request, ...overrides }}
      coordinators={coordinators}
      user={actor}
    />
  );
}

const decisions = () =>
  screen.getByRole("region", { name: "Change requests awaiting your decision" });

beforeEach(() => {
  vi.resetAllMocks();
  invalidate.mockResolvedValue(undefined);
});

describe("processing a change request: inputs (PTR-52 AC2)", () => {
  it("applies in every status a request can be raised in, and in no closed one", () => {
    expect(EVENT_REQUEST_STATUSES.filter(canApplyEventChangeRequest)).toEqual([
      "submitted",
      "under_review",
      "approved",
      "rejected",
      "awaiting_organiser",
      "planning",
      "confirmed",
    ] satisfies EventRequestStatus[]);
  });

  it("parses the decline with its request id and reason, and refuses either missing", () => {
    expect(
      parseEventChangeRequestDeclineInput({ id: 7, changeRequestId: 31, reason: "  No room. " })
    ).toEqual({ id: 7, changeRequestId: 31, reason: "No room." });
    expect(() => parseEventChangeRequestDeclineInput({ id: 7, reason: "No room." })).toThrow(
      "Choose a change request"
    );
    expect(() =>
      parseEventChangeRequestDeclineInput({ id: 7, changeRequestId: 31, reason: " " })
    ).toThrow("Enter a reason for declining");
  });

  it("carries the change request id beside the amendments on an apply", () => {
    expect(
      parseEventInformationInput({
        id: 7,
        amendments: { expectedAttendance: 150 },
        changeRequestId: 31,
      })
    ).toEqual({ id: 7, amendments: { expectedAttendance: 150 }, changeRequestId: 31 });
    expect(() => parseEventInformationInput({ id: 7, amendments: {}, changeRequestId: 0 })).toThrow(
      "Choose a change request"
    );
  });
});

describe("the Coordinator's decisions on a change request (PTR-52)", () => {
  it("lists only the waiting requests, numbered as the record numbers them, to the assigned Coordinator", () => {
    renderPage({ changeRequests: [applied, waiting, declined] });

    const region = decisions();
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
    expect(within(region).getByText("Change request #2")).toBeTruthy();
    expect(within(region).getByText("150 attendees")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Apply change request #2" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Decline change request #2" })).toBeTruthy();
  });

  it("offers nothing when no request waits, or to a Coordinator the event is not assigned to", () => {
    const { unmount } = renderPage({ changeRequests: [applied, declined] });
    expect(
      screen.queryByRole("region", { name: "Change requests awaiting your decision" })
    ).toBeNull();
    unmount();

    renderPage({ assignedCoordinatorId: "coord-b" });
    expect(
      screen.queryByRole("region", { name: "Change requests awaiting your decision" })
    ).toBeNull();
  });

  it.each(["submitted", "under_review", "awaiting_organiser"] satisfies EventRequestStatus[])(
    "offers the apply on a %s event, where a direct edit is not offered",
    status => {
      renderPage({
        status,
        decidedByCoordinatorId: null,
        decidedByCoordinatorName: null,
        decidedAt: null,
      });

      expect(screen.getByRole("button", { name: "Apply change request #1" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Edit event information" })).toBeNull();
    }
  );

  it("offers only the decline on a completed event, and says why", () => {
    renderPage({
      status: "completed",
      completedById: "coord-a",
      completedByName: "Alex",
      completedAt: new Date("2031-01-01T00:00:00Z"),
    });

    const region = decisions();
    expect(within(region).getByText(/can no longer be changed/)).toBeTruthy();
    expect(within(region).queryByRole("button", { name: /^Apply/ })).toBeNull();
    expect(within(region).getByRole("button", { name: "Decline change request #1" })).toBeTruthy();
  });

  it("applies a request by saving the event information with the request pinned, and tells the Organiser (AC2, AC5)", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["eventName"], notified: 0 });
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByLabelText("Event name (required)")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));

    // The form opens on the request, with the request text pinned and focused. The text now shows
    // three times: the decisions card, the pinned request, and the record further down.
    const pinned = screen.getByRole("heading", { name: "Applying the Organiser's change request" });
    expect(document.activeElement).toBe(pinned);
    expect(screen.getAllByText("150 attendees")).toHaveLength(3);
    const applyButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Apply change request #1",
    });
    expect(applyButton.textContent).toBe("Applying below");
    expect(applyButton.disabled).toBe(true);
    const name = screen.getByLabelText("Event name (required)");
    await user.clear(name);
    await user.type(name, "Annual Gala Dinner");
    await user.click(screen.getByRole("button", { name: "Save and mark applied" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Change request applied. The Organiser will be notified."
      )
    );
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { eventName: "Annual Gala Dinner" }, changeRequestId: 31 },
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByLabelText("Event name (required)")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply change request #1" })).toBeTruthy();
  });

  it("warns before applying a significant change, exactly as a direct edit does (AC3)", async () => {
    listEventArrangements.mockResolvedValue({
      venueBookings: [],
      venueHolds: [],
      equipmentReservations: [],
    });
    updateEventInformation.mockResolvedValue({
      changedFields: ["expectedAttendance"],
      notified: 0,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(attendance, "150");
    await user.click(screen.getByRole("button", { name: "Save and mark applied" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(updateEventInformation).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(updateEventInformation).toHaveBeenCalled());
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: {
        id: 7,
        amendments: { expectedAttendance: 150 },
        acknowledgeSignificant: true,
        changeRequestId: 31,
      },
    });
  });

  it("shows the refusal of an apply that changed nothing, with the form still open", async () => {
    updateEventInformation.mockRejectedValue(
      new Error("Make the requested change before applying it, or decline it with a reason.")
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    await user.click(screen.getByRole("button", { name: "Save and mark applied" }));

    expect(
      await screen.findByText(
        "Make the requested change before applying it, or decline it with a reason."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and mark applied" })).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
  });

  it("closes the pinned request when the Coordinator cancels editing", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    await user.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(screen.queryByLabelText("Event name (required)")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply change request #1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit event information" })).toBeTruthy();
    expect(updateEventInformation).not.toHaveBeenCalled();
  });

  it("requires a reason to decline, then sends it and tells the Organiser (AC2, AC5)", async () => {
    declineEventChangeRequest.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline change request #1" }));
    await user.click(
      screen.getByRole("button", { name: "Send the reason and decline change request #1" })
    );

    expect(await screen.findByText("Enter a reason for declining")).toBeTruthy();
    expect(declineEventChangeRequest).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Reason for declining"), "The hall holds 80 at most.");
    await user.click(
      screen.getByRole("button", { name: "Send the reason and decline change request #1" })
    );

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Change request declined. The Organiser will be notified."
      )
    );
    expect(declineEventChangeRequest).toHaveBeenCalledWith({
      data: { id: 7, changeRequestId: 31, reason: "The hall holds 80 at most." },
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows the server's refusal of a decline", async () => {
    declineEventChangeRequest.mockRejectedValue(
      new Error("This change request is not waiting to be processed.")
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline change request #1" }));
    await user.type(screen.getByLabelText("Reason for declining"), "Too late.");
    await user.click(
      screen.getByRole("button", { name: "Send the reason and decline change request #1" })
    );

    expect(
      await screen.findByText("This change request is not waiting to be processed.")
    ).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
  });
});

describe("the record of a change request (PTR-52 AC5)", () => {
  it("keeps every request with its outcome, who processed it, and the reason for a decline, for the Organiser", () => {
    render(
      <EventRequestDetailPage
        request={{ ...request, changeRequests: [waiting, applied, declined] }}
      />
    );

    const section = screen.getByRole("region", { name: "Change requests" });
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Waiting for Alex to process it.")).toBeTruthy();
    expect(
      within(items[1]).getByText(
        /Applied by Alex on .*The record below shows the new information\./
      )
    ).toBeTruthy();
    expect(within(items[2]).getByText(/Declined by Alex on /)).toBeTruthy();
    expect(within(items[2]).getByText("Harbour Hall holds 80 at most.")).toBeTruthy();
    expect(within(items[1]).queryByText("Reason")).toBeNull();
  });

  it("says a waiting request waits for a Coordinator to be assigned when none is", () => {
    render(
      <EventRequestDetailPage
        request={{ ...request, assignedCoordinatorId: null, coordinator: null }}
      />
    );

    expect(screen.getByText("Waiting for a Coordinator to be assigned.")).toBeTruthy();
  });
});
