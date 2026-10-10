import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  coordinatorClosingSections,
  coordinatorSections,
} from "#/features/coordination/components/coordinator-sections";
import { DECISION_REASON_REQUIRED } from "#/features/coordination/schema";
import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EventPageData } from "#/features/events/page-data";

const {
  assignEventRequest,
  requestEventHandover,
  takeUpEventRequestForReview,
  decideEventRequest,
  raiseClarificationRequest,
  invalidate,
  success,
} = vi.hoisted(() => ({
  assignEventRequest: vi.fn<(input: unknown) => Promise<unknown>>(),
  requestEventHandover: vi.fn<(input: unknown) => Promise<unknown>>(),
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
  requestEventHandover,
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
    pendingHandover: null,
    ...overrides,
  } as unknown as CoordinationRequest;
}

function eventData(
  status: EventRequestStatus,
  request: CoordinationRequest,
  team: Coordinator[] = coordinators
): EventPageData {
  return {
    kind: "event",
    viewerId: viewer.id,
    event: {
      access: "coordinator",
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
    viewerId: viewer.id,
    request,
    coordinators: team,
  } as unknown as EventPageData;
}

function renderSection(data: EventPageData, id: string, closing = false) {
  cleanup();
  const sections = closing ? coordinatorClosingSections(data) : coordinatorSections(data);
  const section = sections.find(candidate => candidate.id === id);
  expect(section).toBeDefined();
  return render(<>{section?.render(data)}</>);
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
  it("lists request and assignment only, never the review flow", () => {
    const data = triageData(coordinationRequest());
    const visible = coordinatorSections(data)
      .filter(section => section.visible(data))
      .map(section => section.id);

    expect(visible).toEqual(["request", "assignment"]);
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
    },
  ];

  it("shows the change history for the assigned coordinator but not in triage", () => {
    renderSection(
      eventData("approved", owned({ status: "approved", changeRequests: history })),
      "changes"
    );
    expect(screen.getByText("Move the start to 10:00.")).toBeTruthy();

    const triage = triageData(
      coordinationRequest({ status: "submitted", changeRequests: history })
    );
    expect(
      coordinatorSections(triage)
        .find(section => section.id === "changes")
        ?.visible(triage)
    ).toBe(false);
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

describe("assignment section", () => {
  it("offers assignment with a claim action while unassigned", async () => {
    renderSection(triageData(coordinationRequest()), "assignment");
    expect(screen.getByRole("heading", { name: "Assignment and handover" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Assign this request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign Coordinator" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Assign to me" })).toBeTruthy();
    const contact = screen.getByRole("link", { name: "ravi.kumar@example.com" });
    expect(contact.getAttribute("href")).toBe("mailto:ravi.kumar@example.com");
  });

  it("assigns to the viewer and refreshes the page in place", async () => {
    renderSection(triageData(coordinationRequest()), "assignment");
    await userEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: viewer.id, expectedCoordinatorId: null },
      })
    );
    expect(success).toHaveBeenCalledWith("Assignment recorded.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("offers a handover while assigned, without a claim action", async () => {
    renderSection(eventData("planning", owned({ status: "planning" })), "assignment");
    expect(screen.getByRole("heading", { name: "Hand over this request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
  });

  it("requests a handover with the expected coordinator", async () => {
    renderSection(eventData("planning", owned({ status: "planning" })), "assignment");
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: "Bailey (b@example.com)" }));
    await userEvent.click(screen.getByRole("button", { name: "Hand over" }));
    await waitFor(() =>
      expect(requestEventHandover).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: viewer.id },
      })
    );
    expect(success).toHaveBeenCalledWith("Handover requested.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("replaces a waiting handover with the expected coordinator", async () => {
    renderSection(
      eventData(
        "planning",
        owned({
          status: "planning",
          pendingHandover: { requestedAt: new Date("2026-09-20T02:00:00Z"), toName: "Bailey" },
        })
      ),
      "assignment"
    );
    await userEvent.click(screen.getByLabelText("Event Coordinator"));
    await userEvent.click(await screen.findByRole("option", { name: "Bailey (b@example.com)" }));
    await userEvent.click(screen.getByRole("button", { name: "Offer to someone else" }));
    await waitFor(() =>
      expect(requestEventHandover).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: viewer.id },
      })
    );
    expect(success).toHaveBeenCalledWith("Handover requested.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("keeps the assignment form in a compact readable column", () => {
    const { container } = renderSection(triageData(coordinationRequest()), "assignment");
    const compact = container.querySelector(".max-w-md, .max-w-lg");
    expect(compact).toBeTruthy();
    expect(compact?.textContent).toContain("Assign this request");
  });

  it("shows the waiting handover and offers a replacement", async () => {
    renderSection(
      eventData(
        "planning",
        owned({
          status: "planning",
          pendingHandover: { requestedAt: new Date("2026-09-20T02:00:00Z"), toName: "Bailey" },
        })
      ),
      "assignment"
    );
    expect(screen.getByText(/Offered to Bailey/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Offer to someone else" })).toBeTruthy();
  });

  it("summarises ownership beside the handover form", () => {
    renderSection(eventData("planning", owned({ status: "planning" })), "assignment");

    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("Myself")).toBeTruthy();
    expect(screen.getByRole("link", { name: "me@example.com" })).toBeTruthy();
    expect(screen.getByText(/Assigned on/)).toBeTruthy();
    expect(screen.queryByText("Not yet assigned")).toBeNull();
  });

  it("marks an assigned-but-orphaned coordinator as unavailable", () => {
    renderSection(
      eventData("planning", owned({ status: "planning", coordinator: null })),
      "assignment"
    );

    expect(screen.getByText("Assigned coordinator unavailable")).toBeTruthy();
    expect(screen.getByText(/Assigned on/)).toBeTruthy();
    expect(screen.queryByText("Not yet assigned")).toBeNull();
  });

  it("shows the unassigned state in the summary", () => {
    renderSection(triageData(coordinationRequest()), "assignment");

    expect(screen.getByText("Not yet assigned")).toBeTruthy();
    expect(screen.queryByText(/Assigned on/)).toBeNull();
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

  it("renders nothing in triage and with no waiting request", () => {
    const triage = triageData(
      coordinationRequest({ status: "planning", cancellationRequests: waiting })
    );
    expect(
      coordinatorSections(triage)
        .find(section => section.id === "cancellation")
        ?.visible(triage)
    ).toBe(false);

    const settled = renderSection(
      eventData("planning", owned({ status: "planning" })),
      "cancellation"
    );
    expect(settled.container.textContent).toBe("");
  });
});

describe("confirm section", () => {
  it("offers confirmation for a plannable assigned event", () => {
    renderSection(eventData("planning", owned({ status: "planning" })), "confirm", true);
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
    renderSection(data, "complete", true);
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
    renderSection(data, "complete", true);
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
      true
    );
    expect(screen.getByText(/Harbor Hall/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "release it on the venue calendar" })).toBeTruthy();
  });

  it("renders nothing with no outstanding releases", () => {
    const { container } = renderSection(
      eventData("cancelled", owned({ status: "cancelled" })),
      "releases",
      true
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
