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
  whatShouldChange: "Expected attendance",
  requestedValue: "150 attendees",
  createdAt: new Date("2026-09-17T02:00:00Z"),
  outcome: null,
  declineReason: null,
  processedByName: null,
  processedAt: null,
};
const applied = {
  ...waiting,
  id: 32,
  whatShouldChange: "Event name",
  requestedValue: "Annual Gala Dinner",
  outcome: "applied" as const,
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

    // The form opens on the request, with the request text pinned and focused.
    const pinned = screen.getByRole("heading", { name: "Applying the Organiser's change request" });
    expect(document.activeElement).toBe(pinned);
    expect(within(pinned.parentElement as HTMLElement).getByText("150 attendees")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Apply the change request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel applying" })).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply change request #1" }).disabled
    ).toBe(true);
    expect(screen.getByText("Being applied in the form below.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline change request #1" })).toBeNull();
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
    // The re-read will take the applied request off the card; focus goes back to the card.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Change requests awaiting your decision" })
    );
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

  it("closes the pinned request when the Coordinator cancels applying, and returns to the decisions card", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    await user.click(screen.getByRole("button", { name: "Cancel applying" }));

    expect(screen.queryByLabelText("Event name (required)")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply change request #1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit event information" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Change requests awaiting your decision" })
    );
    expect(updateEventInformation).not.toHaveBeenCalled();
  });

  it("returns focus to the decisions card when the apply form closes on an event with no direct edit", async () => {
    const user = userEvent.setup();
    renderPage({
      status: "submitted",
      decidedByCoordinatorId: null,
      decidedByCoordinatorName: null,
      decidedAt: null,
    });

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    expect(screen.getByRole("heading", { name: "Apply the change request" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel applying" }));

    expect(screen.queryByRole("heading", { name: "Apply the change request" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Change requests awaiting your decision" })
    );
  });

  it("holds every apply while the form has unsaved edits, so no edit is lost to a switch", async () => {
    const user = userEvent.setup();
    renderPage({ changeRequests: [waiting, { ...waiting, id: 34, whatShouldChange: "Date" }] });

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply change request #2" }).disabled
    ).toBe(false);
    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Apply change request #2" }).disabled
    ).toBe(true);
    // Discarding the edits frees the other apply again.
    await user.click(screen.getByRole("button", { name: "Cancel applying" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Apply change request #2" }).disabled
      ).toBe(false)
    );
  });

  it("closes the pinned request when the record shows it processed elsewhere", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPage();
    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    expect(screen.getByRole("heading", { name: "Apply the change request" })).toBeTruthy();

    // A page re-read after another tab declined the request.
    rerender(
      <CoordinationRequestPage
        request={{ ...request, changeRequests: [declined] }}
        coordinators={coordinators}
        user={actor}
      />
    );

    expect(screen.queryByRole("heading", { name: "Apply the change request" })).toBeNull();
  });

  it("names the arrangements the event holds in the warning on an apply, and tells the holders too (AC3)", async () => {
    listEventArrangements.mockResolvedValue({
      venueBookings: [
        {
          id: "booking-1",
          venueName: "Harbour Hall",
          startsAt: "2030-12-01 18:00:00",
          endsAt: "2030-12-01 22:00:00",
        },
      ],
      venueHolds: [],
      equipmentReservations: [{ id: "line-1", item: "Projector", quantity: 2 }],
    });
    updateEventInformation.mockResolvedValue({
      changedFields: ["expectedAttendance"],
      notified: 2,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Apply change request #1" }));
    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(attendance, "150");
    await user.click(screen.getByRole("button", { name: "Save and mark applied" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual([
      "Venue booking: Harbour Hall, 1 Dec 2030, 18:00 – 22:00",
      "Equipment reservation: Projector × 2",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Change request applied. The Organiser will be notified. The staff holding its arrangements will be notified."
      )
    );
  });

  it("requires a reason to decline, then sends it and tells the Organiser (AC2, AC5)", async () => {
    declineEventChangeRequest.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline change request #1" }));
    // The reason takes focus, and the toggle gives way to the form's own cancel.
    const reason = screen.getByLabelText("Reason for declining");
    expect(document.activeElement).toBe(reason);
    expect(screen.queryByRole("button", { name: "Decline change request #1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Decline request #1 with this reason" }));

    expect(await screen.findByText("Enter a reason for declining")).toBeTruthy();
    expect(declineEventChangeRequest).not.toHaveBeenCalled();

    await user.type(reason, "The hall holds 80 at most.");
    await user.click(screen.getByRole("button", { name: "Decline request #1 with this reason" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Change request declined. The Organiser will be notified."
      )
    );
    expect(declineEventChangeRequest).toHaveBeenCalledWith({
      data: { id: 7, changeRequestId: 31, reason: "The hall holds 80 at most." },
    });
    expect(invalidate).toHaveBeenCalled();
    // The re-read takes the item away; focus lands on the card's heading.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Change requests awaiting your decision" })
      )
    );
  });

  it("closes the reason form without declining on cancel", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline change request #1" }));
    await user.type(screen.getByLabelText("Reason for declining"), "Draft reason");
    await user.click(screen.getByRole("button", { name: "Cancel declining change request #1" }));

    expect(screen.queryByLabelText("Reason for declining")).toBeNull();
    expect(screen.getByRole("button", { name: "Decline change request #1" })).toBeTruthy();
    expect(declineEventChangeRequest).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of a decline", async () => {
    declineEventChangeRequest.mockRejectedValue(
      new Error("This change request is not waiting to be processed.")
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Decline change request #1" }));
    await user.type(screen.getByLabelText("Reason for declining"), "Too late.");
    await user.click(screen.getByRole("button", { name: "Decline request #1 with this reason" }));

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
