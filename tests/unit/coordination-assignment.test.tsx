import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import {
  DECISION_REASON_REQUIRED,
  parseAssignmentInput,
  parseDecisionInput,
  parseEventHandoverId,
} from "#/features/coordination/schema";
import type { AssignmentValues } from "#/features/coordination/schema";
import type { CoordinationRequest } from "#/features/coordination/server-fns";

const {
  assignEventRequest,
  decideEventRequest,
  requestEventHandover,
  takeUpEventRequestForReview,
  navigate,
  invalidate,
  success,
} = vi.hoisted(() => ({
  assignEventRequest: vi.fn<(input: { data: AssignmentValues }) => Promise<unknown>>(),
  decideEventRequest:
    vi.fn<
      (input: {
        data: { id: number; decision: "approved" | "rejected"; reason?: string };
      }) => Promise<unknown>
    >(),
  requestEventHandover: vi.fn<(input: { data: AssignmentValues }) => Promise<unknown>>(),
  takeUpEventRequestForReview: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));
vi.mock("#/features/coordination/server-fns", () => ({
  assignEventRequest,
  decideEventRequest,
  raiseClarificationRequest: vi.fn<() => Promise<never>>(),
  requestEventHandover,
  takeUpEventRequestForReview,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { requestId: string };
  }) => <a href={params ? to.replace("$requestId", params.requestId) : to}>{children}</a>,
  useNavigate: () => navigate,
  useRouter: () => ({
    navigate: vi.fn<() => void>(),
    invalidate,
  }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

const actor = { id: "coord-a", email: "a@example.com", name: "Alex", role: "event_coordinator" };
const coordinators = [
  { ...actor, name: "Alex" },
  { id: "coord-b", name: "Bailey", email: "b@example.com" },
];
const request: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Community workshop",
  status: "submitted",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: null,
  assignedCoordinatorId: null,
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
  confirmedById: null,
  confirmedByName: null,
  confirmedAt: null,
  purpose: "Meet neighbours",
  proposedDates: [],
  expectedAttendance: 25,
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
  coordinator: null,
  clarifications: [],
  changeRequests: [],
  pendingHandover: null,
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("assignment validation", () => {
  it("requires the observed assignment and a named Coordinator", () => {
    expect(() => parseAssignmentInput({ id: 7, coordinatorId: "coord-b" })).toThrow(
      /Invalid input/
    );
    expect(() =>
      parseAssignmentInput({ id: 7, coordinatorId: " ", expectedCoordinatorId: null })
    ).toThrow("Choose an Event Coordinator");
    expect(() =>
      parseAssignmentInput({ id: -1, coordinatorId: "coord-b", expectedCoordinatorId: null })
    ).toThrow("Choose an event request");
    expect(() =>
      parseAssignmentInput({
        id: 3_000_000_000,
        coordinatorId: "coord-b",
        expectedCoordinatorId: null,
      })
    ).toThrow("Choose an event request");
    expect(
      parseAssignmentInput({
        id: 7,
        coordinatorId: " coord-b ",
        expectedCoordinatorId: null,
        actorId: "spoofed",
      })
    ).toEqual({ id: 7, coordinatorId: "coord-b", expectedCoordinatorId: null });
  });

  it("requires a handover id that could identify a row", () => {
    expect(() => parseEventHandoverId(undefined)).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({})).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({ id: "3" })).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({ id: 0 })).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({ id: -4 })).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({ id: 2.5 })).toThrow("Choose a handover");
    expect(() => parseEventHandoverId({ id: 3_000_000_000 })).toThrow("Choose a handover");
    expect(parseEventHandoverId({ id: 4 })).toEqual({ id: 4 });
  });
});

describe("decision validation", () => {
  it("requires and trims a rejection reason while allowing approval without one", () => {
    expect(() => parseDecisionInput({ id: 7, decision: "rejected", reason: "  " })).toThrow(
      DECISION_REASON_REQUIRED
    );
    expect(
      parseDecisionInput({ id: 7, decision: "rejected", reason: "  Venue unavailable  " })
    ).toEqual({ id: 7, decision: "rejected", reason: "Venue unavailable" });
    expect(parseDecisionInput({ id: 7, decision: "approved", reason: "  " })).toEqual({
      id: 7,
      decision: "approved",
      reason: "",
    });
  });
});

describe("Coordinator handover and pickup", () => {
  it("picks up an unassigned event as the signed-in Coordinator", async () => {
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: actor.id, expectedCoordinatorId: null },
      })
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/coordination" });
  });

  it("refuses an implicit submit with no Coordinator selected and never calls the server", async () => {
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    // The disabled button does not stop Enter in the focused select from submitting the form.
    const form = screen.getByRole("button", { name: "Assign to me" }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Choose an Event Coordinator");
    expect(assignEventRequest).not.toHaveBeenCalled();
  });

  it("offers an owned event to the selected Coordinator and waits for their answer (AC1, AC2)", async () => {
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          assignedCoordinatorId: actor.id,
          assignedAt: new Date(),
          coordinator: actor,
        }}
        coordinators={coordinators}
        user={actor}
      />
    );
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    // The options are only in the DOM once the select is open, so the current assignee's
    // exclusion is asserted here and not on an empty listbox.
    expect(screen.queryByRole("option", { name: /Alex/ })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: /Bailey/ }));
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    await waitFor(() =>
      expect(requestEventHandover).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: actor.id },
      })
    );
    expect(success).toHaveBeenCalledWith("Handover requested.");
    // The outgoing Coordinator keeps the request, so the page stays and re-reads it.
    expect(invalidate).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The selection clears, so a second raise does not silently replace the offer with the same
    // Coordinator and email them again.
    await waitFor(() =>
      expect(screen.getByLabelText("Event Coordinator").textContent).toContain(
        "Choose an Event Coordinator"
      )
    );
  });

  it("shows the pending handover and offers a replacement while it waits", async () => {
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          assignedCoordinatorId: actor.id,
          assignedAt: new Date(),
          coordinator: actor,
          pendingHandover: {
            requestedAt: new Date("2026-09-20T02:00:00Z"),
            toName: "Bailey",
          },
        }}
        coordinators={coordinators}
        user={actor}
      />
    );

    expect(screen.getByText(/Offered to Bailey/)).toBeTruthy();
    expect(screen.getByText(/You remain the assigned Coordinator/)).toBeTruthy();

    // The incoming Coordinator may never answer, so the outgoing one can offer it to someone
    // else; the server replaces the live offer.
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: /Bailey/ }));
    await userEvent.click(screen.getByRole("button", { name: "Offer to someone else" }));
    await waitFor(() =>
      expect(requestEventHandover).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: actor.id },
      })
    );
  });

  it("still offers a handover while awaiting the Organiser, but not after a decision", () => {
    const owned = {
      ...request,
      status: "awaiting_organiser" as const,
      assignedCoordinatorId: actor.id,
      assignedAt: new Date(),
      coordinator: actor,
    };
    const { rerender } = render(
      <CoordinationRequestPage request={owned} coordinators={coordinators} user={actor} />
    );

    expect(screen.getByRole("heading", { name: "Hand over this request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeTruthy();

    for (const status of ["approved", "rejected"] as const) {
      rerender(
        <CoordinationRequestPage
          request={{ ...owned, status }}
          coordinators={coordinators}
          user={actor}
        />
      );
      expect(screen.queryByRole("heading", { name: "Hand over this request" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Hand over" })).toBeNull();
    }
  });

  it("shows a handover refusal without claiming success or leaving the page", async () => {
    requestEventHandover.mockRejectedValue(new Error("This assignment has changed."));
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          assignedCoordinatorId: actor.id,
          assignedAt: new Date(),
          coordinator: actor,
        }}
        coordinators={coordinators}
        user={actor}
      />
    );
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: /Bailey/ }));
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This assignment has changed."
    );
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a server refusal without claiming success or navigating away", async () => {
    assignEventRequest.mockRejectedValue(new Error("This assignment has changed."));
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This assignment has changed."
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("disables both assignment actions while a pickup is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    assignEventRequest.mockReturnValue(promise);
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(screen.getByRole("button", { name: "Assign to me" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Assigning…" })).toHaveProperty("disabled", true);
    resolve({});
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});

describe("Review pickup", () => {
  const owned = { ...request, assignedCoordinatorId: actor.id, assignedAt: new Date() };

  it("offers review pickup to the assigned Coordinator on a submitted request", () => {
    render(<CoordinationRequestPage request={owned} coordinators={coordinators} user={actor} />);
    expect(screen.getByRole("button", { name: "Take up for review" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Take up for review" })).toBeTruthy();
  });

  it("hides review pickup once the request is under review", () => {
    render(
      <CoordinationRequestPage
        request={{ ...owned, status: "under_review" }}
        coordinators={coordinators}
        user={actor}
      />
    );
    expect(screen.queryByRole("button", { name: "Take up for review" })).toBeNull();
  });

  it("hides review pickup when another Coordinator is assigned", () => {
    render(
      <CoordinationRequestPage
        request={{ ...owned, assignedCoordinatorId: "coord-b" }}
        coordinators={coordinators}
        user={actor}
      />
    );
    expect(screen.queryByRole("button", { name: "Take up for review" })).toBeNull();
  });

  it("takes up the request for review and leaves the detail", async () => {
    render(<CoordinationRequestPage request={owned} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Take up for review" }));
    await waitFor(() =>
      expect(takeUpEventRequestForReview).toHaveBeenCalledWith({ data: { id: request.id } })
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/coordination" });
    expect(success).toHaveBeenCalled();
  });

  it("shows a review refusal without claiming success or navigating away", async () => {
    takeUpEventRequestForReview.mockRejectedValue(new Error("This request has changed."));
    render(<CoordinationRequestPage request={owned} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Take up for review" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This request has changed."
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
});

describe("Approval and rejection", () => {
  const underReview = {
    ...request,
    status: "under_review" as const,
    assignedCoordinatorId: actor.id,
    assignedAt: new Date(),
    coordinator: actor,
  };

  it("offers decision controls only to the assigned Coordinator while under review", () => {
    const { rerender } = render(
      <CoordinationRequestPage request={underReview} coordinators={coordinators} user={actor} />
    );
    expect(screen.getByRole("button", { name: "Approve request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeTruthy();

    rerender(
      <CoordinationRequestPage
        request={{ ...underReview, status: "approved" }}
        coordinators={coordinators}
        user={actor}
      />
    );
    expect(screen.queryByRole("button", { name: "Approve request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject request" })).toBeNull();
  });

  it("approves without a reason and returns to the coordination list", async () => {
    render(
      <CoordinationRequestPage request={underReview} coordinators={coordinators} user={actor} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() =>
      expect(decideEventRequest).toHaveBeenCalledWith({
        data: { id: request.id, decision: "approved", reason: "" },
      })
    );
    expect(success).toHaveBeenCalledWith("Request approved.");
    expect(navigate).toHaveBeenCalledWith({ to: "/coordination" });
  });

  it("refuses a blank rejection reason, then records a supplied one", async () => {
    render(
      <CoordinationRequestPage request={underReview} coordinators={coordinators} user={actor} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Reject request" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      DECISION_REASON_REQUIRED
    );
    expect(decideEventRequest).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Decision reason"), "  Venue unavailable  ");
    await userEvent.click(screen.getByRole("button", { name: "Reject request" }));
    await waitFor(() =>
      expect(decideEventRequest).toHaveBeenCalledWith({
        data: { id: request.id, decision: "rejected", reason: "Venue unavailable" },
      })
    );
    expect(success).toHaveBeenCalledWith("Request rejected.");
  });
});
