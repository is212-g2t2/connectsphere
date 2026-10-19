// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeRequestApplyProvider } from "#/features/coordination/components/change-request-decisions";
import {
  coordinatorClosingSections,
  coordinatorSections,
  leadAssignmentSections,
} from "#/features/coordination/components/coordinator-sections";
import { DECISION_REASON_REQUIRED } from "#/features/coordination/schema";
import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EventPageData } from "#/features/events/page-data";

const {
  assignEventRequest,
  takeUpEventRequestForReview,
  decideEventRequest,
  raiseClarificationRequest,
  invalidate,
  success,
} = vi.hoisted(() => ({
  assignEventRequest: vi.fn<(input: unknown) => Promise<unknown>>(),
  takeUpEventRequestForReview: vi.fn<(input: unknown) => Promise<unknown>>(),
  decideEventRequest: vi.fn<(input: unknown) => Promise<unknown>>(),
  raiseClarificationRequest: vi.fn<(input: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));
vi.mock("#/features/coordination/server-fns", () => ({
  assignEventRequest,
  decideEventRequest,
  raiseClarificationRequest,
  takeUpEventRequestForReview,
}));
vi.mock("#/features/events/server-fns", () => ({
  cancelEvent: vi.fn<() => Promise<never>>(),
  confirmEvent: vi.fn<() => Promise<never>>(),
  declineEventCancellation: vi.fn<() => Promise<never>>(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => Promise<void>>(),
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

const viewer = { id: "coord-me", name: "Myself", email: "me@example.com" };
const coordinators = [
  viewer,
  { id: "coord-b", name: "Bailey", email: "b@example.com" },
] as unknown as Coordinator[];

function coordinationRequest(overrides: Record<string, unknown> = {}): CoordinationRequest {
  return {
    id: 7,
    organiserId: "org",
    eventName: "Winter Skills Workshop",
    status: "submitted",
    submittedAt: new Date("2026-09-15T02:00:00Z"),
    assignedAt: null,
    assignedCoordinatorId: null,
    decisionReason: null,
    decidedByCoordinatorId: null,
    decidedByCoordinatorName: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organiser: { name: "Ravi Kumar", email: "ravi.kumar@example.com" },
    coordinator: null,
    clarifications: [],
    changeRequests: [],
    cancellationRequests: [],
    outstandingReleases: null,
    ...overrides,
  } as unknown as CoordinationRequest;
}

function eventData(
  status: EventRequestStatus,
  request: CoordinationRequest,
  team: Coordinator[] = coordinators,
  access: "coordinator" | "lead" = "coordinator"
): EventPageData {
  return {
    kind: "event",
    event: {
      access,
      event: {
        id: 7,
        name: "Winter Skills Workshop",
        status,
        eventDate: "2026-12-12",
        startTime: "09:00",
        endTime: "17:00",
      },
    },
    coordination: { request, coordinators: team },
  } as unknown as EventPageData;
}

function triageData(
  request: CoordinationRequest,
  team: Coordinator[] = coordinators
): EventPageData {
  return {
    kind: "triage",
    request,
    coordinators: team,
  } as unknown as EventPageData;
}

function renderSection(data: EventPageData, id: string, sectionsFor = coordinatorSections) {
  cleanup();
  const section = sectionsFor(data).find(candidate => candidate.id === id);
  expect(section).toBeDefined();
  // The event page holds the change-request apply. Its sections share it (PTR-52).
  return render(<ChangeRequestApplyProvider>{section?.render(data)}</ChangeRequestApplyProvider>);
}

const owned = (overrides: Record<string, unknown> = {}) =>
  coordinationRequest({
    status: "submitted",
    assignedCoordinatorId: viewer.id,
    assignedAt: new Date("2026-09-16T02:00:00Z"),
    coordinator: { ...viewer },
    ...overrides,
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("review section", () => {
  it("offers take-up only for a submitted request assigned to the viewer", () => {
    renderSection(eventData("submitted", owned()), "review");
    expect(screen.getByRole("heading", { name: "Review decision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take up for review" })).toBeTruthy();
  });

  it("hides take-up once under review and everywhere in triage", () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    expect(screen.queryByRole("button", { name: "Take up for review" })).toBeNull();

    renderSection(triageData(coordinationRequest()), "review");
    expect(screen.queryByRole("button", { name: "Take up for review" })).toBeNull();
  });

  it("takes up the request and refreshes the page in place", async () => {
    renderSection(eventData("submitted", owned()), "review");
    await userEvent.click(screen.getByRole("button", { name: "Take up for review" }));
    await waitFor(() =>
      expect(takeUpEventRequestForReview).toHaveBeenCalledWith({ data: { id: 7 } })
    );
    expect(success).toHaveBeenCalledWith("Request taken up for review.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("offers the decision only while under review and assigned", () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    expect(screen.getByRole("button", { name: "Approve request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeTruthy();
    expect(screen.getByLabelText("Decision reason")).toBeTruthy();
    expect(
      screen.getByText(/A reason is required for rejection and optional for approval/)
    ).toBeTruthy();
  });

  it("hides the decision once submitted and everywhere in triage", () => {
    renderSection(eventData("submitted", owned()), "review");
    expect(screen.queryByRole("button", { name: "Approve request" })).toBeNull();

    renderSection(triageData(coordinationRequest({ status: "under_review" })), "review");
    expect(screen.queryByRole("button", { name: "Approve request" })).toBeNull();
  });

  it("approves without a reason and refreshes the page in place", async () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    await userEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() =>
      expect(decideEventRequest).toHaveBeenCalledWith({
        data: { id: 7, decision: "approved", reason: "" },
      })
    );
    expect(success).toHaveBeenCalledWith("Request approved.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("refuses a blank rejection reason", async () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    await userEvent.click(screen.getByRole("button", { name: "Reject request" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      DECISION_REASON_REQUIRED
    );
    expect(decideEventRequest).not.toHaveBeenCalled();
  });

  it("offers clarification while the request waits on either side", () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    expect(screen.getByRole("button", { name: "Send clarification request" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Event name" })).toBeTruthy();
  });

  it("hides clarification once submitted and everywhere in triage", () => {
    renderSection(eventData("submitted", owned()), "review");
    expect(screen.queryByRole("button", { name: "Send clarification request" })).toBeNull();

    renderSection(triageData(coordinationRequest({ status: "awaiting_organiser" })), "review");
    expect(screen.queryByRole("button", { name: "Send clarification request" })).toBeNull();
  });

  it("sends a clarification request and refreshes the page in place", async () => {
    renderSection(eventData("under_review", owned({ status: "under_review" })), "review");
    await userEvent.type(screen.getByLabelText("What needs clarification"), "Which layout?");
    await userEvent.click(screen.getByRole("checkbox", { name: "Purpose" }));
    await userEvent.click(screen.getByRole("button", { name: "Send clarification request" }));
    await waitFor(() =>
      expect(raiseClarificationRequest).toHaveBeenCalledWith({
        data: { id: 7, body: "Which layout?", permittedFields: ["purpose"] },
      })
    );
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("request section", () => {
  const record = {
    status: "under_review",
    proposedDates: [{ start: "2026-12-12T09:00", end: "2026-12-12T17:00" }],
    expectedAttendance: 80,
    roomLayoutPreference: "Theatre",
    accessibilityRequirements: "Step-free access and hearing loop",
    venueRequirements: "6 power drops, WiFi",
    equipmentRequirements: [{ type: "PA", quantity: 1 }],
    purpose: "Skills workshops",
    description: "A workshop day.",
    coordinator: { name: "Jonas Weber", email: "jonas.weber@example.com" },
  };

  it("shows the read-only record for the assigned coordinator", () => {
    renderSection(eventData("under_review", owned({ ...record })), "request");

    expect(screen.getByRole("heading", { name: "Request details" })).toBeTruthy();
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("12 Dec 2026, 09:00 – 17:00")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText("Theatre")).toBeTruthy();
    expect(screen.getByText("Step-free access and hearing loop")).toBeTruthy();
    expect(screen.getByText("6 power drops, WiFi")).toBeTruthy();
    expect(screen.getByText("1× PA")).toBeTruthy();
    expect(screen.getByText("Skills workshops")).toBeTruthy();
    expect(screen.getByText("A workshop day.")).toBeTruthy();
    const contact = screen.getByRole("link", { name: "jonas.weber@example.com" });
    expect(contact.getAttribute("href")).toBe("mailto:jonas.weber@example.com");
  });

  it("shows the record in triage with an unassigned coordinator", () => {
    renderSection(
      triageData(coordinationRequest({ ...record, status: "submitted", coordinator: null })),
      "request"
    );

    expect(screen.getByRole("heading", { name: "Request details" })).toBeTruthy();
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("Not yet assigned")).toBeTruthy();
  });

  it("marks an assigned-but-orphaned coordinator as unavailable in the record", () => {
    renderSection(
      triageData(
        coordinationRequest({
          ...record,
          status: "submitted",
          assignedCoordinatorId: viewer.id,
          assignedAt: new Date("2026-09-16T02:00:00Z"),
          coordinator: null,
        })
      ),
      "request"
    );

    expect(screen.getByText("Assigned coordinator unavailable")).toBeTruthy();
    expect(screen.queryByText("Not yet assigned")).toBeNull();
  });

  it("hides the record once the request is decided", () => {
    for (const status of ["approved", "planning", "confirmed"] as const) {
      const data = eventData(status, owned({ ...record, status }));
      expect(
        coordinatorSections(data)
          .find(section => section.id === "request")
          ?.visible(data)
      ).toBe(false);
    }
  });
});

describe("triage section set", () => {
  it("lists the read-only request detail and the Lead's assignment form, with no review flow", () => {
    const data = triageData(coordinationRequest());
    const visible = coordinatorSections(data)
      .filter(section => section.visible(data))
      .map(section => section.id);

    expect(visible).toEqual(["request"]);
    expect(
      leadAssignmentSections(data)
        .find(section => section.id === "assignment")
        ?.visible(data)
    ).toBe(true);
  });

  it("keeps the request detail for a vacated request past review", () => {
    // A deleted Coordinator can vacate an approved event; the queue row still opens the record.
    const data = triageData(coordinationRequest({ status: "approved" }));
    const defs = coordinatorSections(data);

    expect(defs.find(section => section.id === "request")?.visible(data)).toBe(true);
    expect(defs.find(section => section.id === "review")?.visible(data)).toBe(false);
    expect(defs.find(section => section.id === "assignment")).toBeUndefined();
  });

  it("hides the Lead's assignment form once the request is closed (PTR-145 AC3)", () => {
    const closed = triageData(coordinationRequest({ status: "rejected" }));
    expect(
      leadAssignmentSections(closed)
        .find(section => section.id === "assignment")
        ?.visible(closed)
    ).toBe(false);
  });
});

describe("messages section", () => {
  const thread = [
    {
      id: 11,
      body: "Do you need the kitchen for catering?",
      createdAt: new Date("2026-09-18T02:00:00Z"),
      replyBody: "No, just the main hall.",
      repliedAt: new Date("2026-09-19T02:00:00Z"),
      amendments: [],
      permittedFields: [],
    },
  ];

  it("shows the clarification thread for the assigned coordinator", () => {
    renderSection(
      eventData("under_review", owned({ status: "under_review", clarifications: thread })),
      "messages"
    );
    expect(screen.getByRole("heading", { name: "Clarification requests" })).toBeTruthy();
    expect(screen.getByText("Do you need the kitchen for catering?")).toBeTruthy();
    expect(screen.getByText("No, just the main hall.")).toBeTruthy();
  });

  it("shows the thread for the assigned coordinator but not in triage", () => {
    renderSection(
      eventData("under_review", owned({ status: "under_review", clarifications: thread })),
      "messages"
    );
    expect(screen.getByText("Do you need the kitchen for catering?")).toBeTruthy();

    const triage = triageData(
      coordinationRequest({ status: "under_review", clarifications: thread })
    );
    expect(
      coordinatorSections(triage)
        .find(section => section.id === "messages")
        ?.visible(triage)
    ).toBe(false);
  });

  it("renders nothing with no clarifications", () => {
    const { container } = renderSection(triageData(coordinationRequest()), "messages");
    expect(container.textContent).toBe("");
  });

  it("hides the section until the thread has entries", () => {
    const empty = eventData("under_review", owned({ status: "under_review" }));
    expect(
      coordinatorSections(empty)
        .find(section => section.id === "messages")
        ?.visible(empty)
    ).toBe(false);

    const full = eventData(
      "under_review",
      owned({ status: "under_review", clarifications: thread })
    );
    expect(
      coordinatorSections(full)
        .find(section => section.id === "messages")
        ?.visible(full)
    ).toBe(true);
  });
});

describe("changes section", () => {
  const history = [
    {
      id: 3,
      createdAt: new Date("2026-09-20T02:00:00Z"),
      whatShouldChange: "Start time",
      requestedValue: "Move the start to 10:00.",
      outcome: "applied",
      declineReason: null,
      processedByName: "Myself",
      processedAt: new Date("2026-09-21T02:00:00Z"),
    },
  ];

  it("shows the change history for the assigned coordinator but not in triage", () => {
    renderSection(
      eventData("approved", owned({ status: "approved", changeRequests: history })),
      "changes"
    );
    expect(screen.getByText("Move the start to 10:00.")).toBeTruthy();
  });

  it("shows the history read-only in the Lead's triage, without the decisions", () => {
    const triage = triageData(
      coordinationRequest({ status: "submitted", changeRequests: history })
    );
    expect(
      coordinatorSections(triage)
        .find(section => section.id === "changes")
        ?.visible(triage)
    ).toBe(true);
    renderSection(triage, "changes");
    expect(screen.getByText("Move the start to 10:00.")).toBeTruthy();
    // The decisions card needs an assignee, so triage carries no action.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders nothing with no change history", () => {
    const { container } = renderSection(
      eventData("approved", owned({ status: "approved" })),
      "changes"
    );
    expect(container.textContent).toBe("");
  });

  it("hides the section with no change history, even while raisable", () => {
    const empty = eventData("submitted", owned({ status: "submitted" }));
    expect(
      coordinatorSections(empty)
        .find(section => section.id === "changes")
        ?.visible(empty)
    ).toBe(false);

    const full = eventData("approved", owned({ status: "approved", changeRequests: history }));
    expect(
      coordinatorSections(full)
        .find(section => section.id === "changes")
        ?.visible(full)
    ).toBe(true);
  });
});

function leadEventData(
  status: EventRequestStatus,
  request: CoordinationRequest,
  team: Coordinator[] = coordinators
): EventPageData {
  return eventData(status, request, team, "lead");
}

function renderLeadSection(data: EventPageData, id: string) {
  return renderSection(data, id, leadAssignmentSections);
}

describe("Lead assignment section (PTR-145)", () => {
  it("assigns the chosen Coordinator on an unassigned request and refreshes", async () => {
    renderLeadSection(triageData(coordinationRequest()), "assignment");

    expect(screen.getByText("Not yet assigned")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: "Bailey (b@example.com)" }));
    await userEvent.click(screen.getByRole("button", { name: "Assign Coordinator" }));

    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: null },
      })
    );
    expect(success).toHaveBeenCalledWith("Coordinator assigned.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("reassigns with the expected current Coordinator and reassigns the label", async () => {
    renderLeadSection(leadEventData("planning", owned({ status: "planning" })), "assignment");

    expect(screen.getByRole("button", { name: "Reassign Coordinator" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "me@example.com" })).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: "Bailey (b@example.com)" }));
    await userEvent.click(screen.getByRole("button", { name: "Reassign Coordinator" }));

    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: viewer.id },
      })
    );
    expect(success).toHaveBeenCalledWith("Coordinator reassigned.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("lists every Coordinator, including the current one, unfiltered and unranked (AC6)", async () => {
    renderLeadSection(leadEventData("planning", owned({ status: "planning" })), "assignment");

    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    expect(await screen.findByRole("option", { name: "Myself (me@example.com)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bailey (b@example.com)" })).toBeTruthy();
  });

  it("surfaces the server refusal and does not claim a move", async () => {
    assignEventRequest.mockRejectedValue(
      new Error("This assignment has changed. Refresh the request and try again.")
    );
    renderLeadSection(triageData(coordinationRequest()), "assignment");

    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: "Bailey (b@example.com)" }));
    await userEvent.click(screen.getByRole("button", { name: "Assign Coordinator" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This assignment has changed. Refresh the request and try again."
    );
    expect(success).not.toHaveBeenCalled();
    // The refusal usually means the page is stale; re-read so the retry carries the new holder.
    expect(invalidate).toHaveBeenCalled();
  });

  it("marks an assigned-but-orphaned coordinator as unavailable", () => {
    renderLeadSection(
      leadEventData("planning", owned({ status: "planning", coordinator: null })),
      "assignment"
    );

    expect(screen.getByText("Assigned coordinator unavailable")).toBeTruthy();
    expect(screen.queryByText("Not yet assigned")).toBeNull();
  });
});

describe("cancellation section", () => {
  const waiting = [
    {
      id: 1,
      createdAt: new Date("2026-10-01T02:00:00Z"),
      outcome: null,
      declineReason: null,
      processedByName: null,
      processedAt: null,
    },
  ];

  it("offers the cancellation decision for the assigned coordinator", () => {
    renderSection(
      eventData("planning", owned({ status: "planning", cancellationRequests: waiting })),
      "cancellation"
    );
    expect(screen.getByRole("heading", { name: "Cancellation request" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cancellation requested" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel event" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline request" })).toBeTruthy();
  });

  it("shows the Lead the read-only history in triage, and nothing with no waiting request", () => {
    const triage = triageData(
      coordinationRequest({ status: "submitted", cancellationRequests: waiting })
    );
    expect(
      coordinatorSections(triage)
        .find(section => section.id === "cancellation")
        ?.visible(triage)
    ).toBe(true);
    renderSection(triage, "cancellation");
    expect(screen.getByRole("heading", { name: "Cancellation requests" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders nothing with no waiting request", () => {
    const settled = renderSection(
      eventData("planning", owned({ status: "planning" })),
      "cancellation"
    );
    expect(settled.container.textContent).toBe("");
  });
});

describe("confirm section", () => {
  it("offers confirmation for a plannable assigned event", () => {
    renderSection(
      eventData("planning", owned({ status: "planning" })),
      "confirm",
      coordinatorClosingSections
    );
    expect(screen.getByRole("heading", { name: "Confirm event" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirm event/ })).toBeTruthy();
  });

  it("has no closing sections in triage", () => {
    expect(coordinatorClosingSections(triageData(coordinationRequest()))).toEqual([]);
  });
});

function confirmedData(reason: string | null): EventPageData {
  const data = eventData("confirmed", owned({ status: "confirmed" }));
  if (data.kind !== "event") throw new Error("expected event data");
  return {
    ...data,
    event: {
      ...data.event,
      event: { ...data.event.event, completionUnavailableReason: reason },
    },
  };
}

function completeSection(data: EventPageData) {
  return coordinatorClosingSections(data).find(section => section.id === "complete");
}

describe("complete section", () => {
  it("is visible for a confirmed event and shows the disabled reason on the info icon", async () => {
    const user = userEvent.setup();
    const data = confirmedData("The event end date and time has not passed.");
    expect(completeSection(data)?.label).toBe("Complete event");
    expect(completeSection(data)?.visible(data)).toBe(true);
    renderSection(data, "complete", coordinatorClosingSections);
    expect(screen.getByRole("heading", { name: "Complete event" })).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Complete event: Winter Skills Workshop" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    await user.hover(
      screen.getByRole("button", {
        name: "Complete event is disabled: The event end date and time has not passed.",
      })
    );

    const tooltip = await screen.findByText("The event end date and time has not passed.", {
      selector: '[data-slot="tooltip-content"]',
    });
    expect(tooltip.textContent).toContain("The event end date and time has not passed.");
  });

  it("enables the action when no disabled reason is present", () => {
    const data = confirmedData(null);
    renderSection(data, "complete", coordinatorClosingSections);
    expect(
      screen
        .getByRole("button", { name: "Complete event: Winter Skills Workshop" })
        .hasAttribute("disabled")
    ).toBe(false);
  });

  it("is not visible for planning", () => {
    const data = eventData("planning", owned({ status: "planning" }));
    expect(completeSection(data)?.visible(data)).toBe(false);
  });

  it("has no complete section in triage", () => {
    expect(
      coordinatorClosingSections(triageData(coordinationRequest({ status: "confirmed" })))
    ).toEqual([]);
  });
});

describe("releases section", () => {
  const releases = {
    venueBookings: [],
    venueHolds: [
      {
        id: "hold-1",
        venueId: 4,
        venueName: "Harbor Hall",
        startsAt: "2026-12-05 10:00:00",
        endsAt: "2026-12-05 14:00:00",
      },
    ],
    equipmentReservations: [],
  };

  it("lists the held booking with its release link", () => {
    renderSection(
      eventData("cancelled", owned({ status: "cancelled", outstandingReleases: releases })),
      "releases",
      coordinatorClosingSections
    );
    expect(screen.getByText(/Harbor Hall/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "release it on the venue calendar" })).toBeTruthy();
  });

  it("renders nothing with no outstanding releases", () => {
    const { container } = renderSection(
      eventData("cancelled", owned({ status: "cancelled" })),
      "releases",
      coordinatorClosingSections
    );
    expect(container.textContent).toBe("");
  });

  it("hides the section when the request carries no releases", () => {
    const empty = eventData("cancelled", owned({ status: "cancelled" }));
    expect(
      coordinatorClosingSections(empty)
        .find(section => section.id === "releases")
        ?.visible(empty)
    ).toBe(false);

    const full = eventData(
      "cancelled",
      owned({ status: "cancelled", outstandingReleases: releases })
    );
    expect(
      coordinatorClosingSections(full)
        .find(section => section.id === "releases")
        ?.visible(full)
    ).toBe(true);
  });
});
