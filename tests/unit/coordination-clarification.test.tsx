import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";

const { raiseClarificationRequest, invalidate, success } = vi.hoisted(() => ({
  raiseClarificationRequest:
    vi.fn<
      (input: {
        data: { id: number; body: string; permittedFields?: string[] };
      }) => Promise<unknown>
    >(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/coordination/server-fns", () => ({
  assignEventRequest: vi.fn<() => Promise<never>>(),
  takeUpEventRequestForReview: vi.fn<() => Promise<never>>(),
  raiseClarificationRequest,
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
  useNavigate: () => vi.fn<() => void>(),
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

const underReviewRequest: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Annual Gala",
  status: "under_review",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: new Date("2026-09-15T03:00:00Z"),
  assignedCoordinatorId: "coord-a",
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
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
};

describe("Clarification requests (PTR-18)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("CoordinationRequestPage", () => {
    it("renders the clarification form when event is under_review and assigned to actor (AC1)", () => {
      render(
        <CoordinationRequestPage
          request={underReviewRequest}
          coordinators={coordinators}
          user={actor}
        />
      );

      expect(screen.getByRole("heading", { name: "Request clarification" })).toBeTruthy();
      expect(screen.getByLabelText("What needs clarification")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send clarification request" })).toBeTruthy();
    });

    it("renders the clarification form when event is awaiting_organiser and assigned to actor (AC5 / Option A)", () => {
      render(
        <CoordinationRequestPage
          request={{ ...underReviewRequest, status: "awaiting_organiser" }}
          coordinators={coordinators}
          user={actor}
        />
      );

      expect(screen.getByRole("heading", { name: "Request clarification" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send clarification request" })).toBeTruthy();
    });

    it("hides the clarification form when event is submitted (not yet under review)", () => {
      render(
        <CoordinationRequestPage
          request={{ ...underReviewRequest, status: "submitted" }}
          coordinators={coordinators}
          user={actor}
        />
      );

      expect(screen.queryByRole("heading", { name: "Request clarification" })).toBeNull();
    });

    it("hides the clarification form when assigned to another coordinator", () => {
      render(
        <CoordinationRequestPage
          request={{ ...underReviewRequest, assignedCoordinatorId: "coord-b" }}
          coordinators={coordinators}
          user={actor}
        />
      );

      expect(screen.queryByRole("heading", { name: "Request clarification" })).toBeNull();
    });

    it("submits clarification, displays success toast, and invalidates router (AC1, AC2)", async () => {
      const user = userEvent.setup();
      raiseClarificationRequest.mockResolvedValueOnce({
        id: 1,
        eventRequestId: 7,
        coordinatorId: "coord-a",
        body: "Please specify dietary requirements.",
        createdAt: new Date(),
      });

      render(
        <CoordinationRequestPage
          request={underReviewRequest}
          coordinators={coordinators}
          user={actor}
        />
      );

      const textarea = screen.getByLabelText("What needs clarification");
      await user.type(textarea, "Please specify dietary requirements.");

      const submitButton = screen.getByRole("button", { name: "Send clarification request" });
      await user.click(submitButton);

      await waitFor(() => {
        expect(raiseClarificationRequest).toHaveBeenCalledWith({
          data: {
            id: 7,
            body: "Please specify dietary requirements.",
            permittedFields: [],
          },
        });
      });

      await waitFor(() => {
        expect(success).toHaveBeenCalledWith("Clarification request sent.");
        expect(invalidate).toHaveBeenCalled();
      });
    });

    it("sends the Coordinator's selected field groups with the clarification", async () => {
      const user = userEvent.setup();
      raiseClarificationRequest.mockResolvedValueOnce({ id: 1 });

      render(
        <CoordinationRequestPage
          request={underReviewRequest}
          coordinators={coordinators}
          user={actor}
        />
      );

      await user.type(
        screen.getByLabelText("What needs clarification"),
        "Please confirm attendance."
      );
      await user.click(screen.getByRole("checkbox", { name: "Expected attendance" }));
      await user.click(screen.getByRole("button", { name: "Send clarification request" }));

      await waitFor(() => {
        expect(raiseClarificationRequest).toHaveBeenCalledWith({
          data: {
            id: 7,
            body: "Please confirm attendance.",
            permittedFields: ["expectedAttendance"],
          },
        });
      });
    });

    it("renders existing clarification requests and their text (AC4, AC5)", () => {
      const requestWithClarifications: CoordinationRequest = {
        ...underReviewRequest,
        status: "awaiting_organiser",
        clarifications: [
          {
            id: 1,
            eventRequestId: 7,
            coordinatorId: "coord-a",
            body: "Need projector model requirements.",
            permittedFields: [],
            replyBody: null,
            repliedAt: null,
            repliedByOrganiserId: null,
            amendments: [],
            createdAt: new Date("2026-09-16T10:00:00Z"),
          },
          {
            id: 2,
            eventRequestId: 7,
            coordinatorId: "coord-a",
            body: "Also please confirm catering timings.",
            permittedFields: [],
            replyBody: null,
            repliedAt: null,
            repliedByOrganiserId: null,
            amendments: [],
            createdAt: new Date("2026-09-16T11:00:00Z"),
          },
        ],
      };

      render(
        <CoordinationRequestPage
          request={requestWithClarifications}
          coordinators={coordinators}
          user={actor}
        />
      );

      expect(screen.getByRole("heading", { name: "Clarification requests" })).toBeTruthy();
      expect(screen.getByText("Need projector model requirements.")).toBeTruthy();
      expect(screen.getByText("Also please confirm catering timings.")).toBeTruthy();
      expect(screen.queryByLabelText("Your reply")).toBeNull();
    });
  });

  describe("EventRequestDetailPage (Organiser view - AC4)", () => {
    it("displays clarification requests and their text to the organiser", () => {
      const organiserSummary: EventRequestDetail = {
        ...underReviewRequest,
        status: "awaiting_organiser",
        coordinator: { name: "Alex", email: "a@example.com" },
        clarifications: [
          {
            id: 1,
            eventRequestId: 7,
            coordinatorId: "coord-a",
            body: "Which layout is required for the workshop?",
            permittedFields: [],
            replyBody: null,
            repliedAt: null,
            repliedByOrganiserId: null,
            amendments: [],
            createdAt: new Date("2026-09-16T08:00:00Z"),
          },
        ],
      };

      render(<EventRequestDetailPage request={organiserSummary} showReplyForms />);

      expect(screen.getByRole("heading", { name: "Clarification requests" })).toBeTruthy();
      expect(screen.getByText("Which layout is required for the workshop?")).toBeTruthy();
      expect(screen.getByText("Awaiting organiser")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send reply" })).toBeTruthy();
    });

    it("keeps unsaved input in a still-open reply form after a sibling clarification is answered", async () => {
      const user = userEvent.setup();
      const clarifications: EventRequestDetail["clarifications"] = [
        {
          id: 1,
          eventRequestId: 7,
          coordinatorId: "coord-a",
          body: "Please confirm the purpose.",
          permittedFields: ["purpose"],
          replyBody: null,
          repliedAt: null,
          repliedByOrganiserId: null,
          amendments: [],
          createdAt: new Date("2026-09-16T08:00:00Z"),
        },
        {
          id: 2,
          eventRequestId: 7,
          coordinatorId: "coord-a",
          body: "Please confirm the event type.",
          permittedFields: ["eventType"],
          replyBody: null,
          repliedAt: null,
          repliedByOrganiserId: null,
          amendments: [],
          createdAt: new Date("2026-09-16T09:00:00Z"),
        },
      ];
      const request: EventRequestDetail = {
        ...underReviewRequest,
        status: "awaiting_organiser",
        coordinator: { name: "Alex", email: "a@example.com" },
        clarifications,
      };

      const { rerender } = render(<EventRequestDetailPage request={request} showReplyForms />);

      const [, secondReply] =
        screen.getAllByLabelText<HTMLTextAreaElement>("Your reply (required)");
      await user.type(secondReply, "Still drafting my answer about the event type.");

      // Simulates the page refetching (`router.invalidate()`) after the FIRST clarification's
      // reply was sent: only that clarification now carries a reply, the second is untouched.
      rerender(
        <EventRequestDetailPage
          request={{
            ...request,
            clarifications: [
              {
                ...clarifications[0],
                replyBody: "The purpose is a fundraiser.",
                repliedAt: new Date("2026-09-16T10:00:00Z"),
                repliedByOrganiserId: "org",
              },
              clarifications[1],
            ],
          }}
          showReplyForms
        />
      );

      expect(screen.getByLabelText<HTMLTextAreaElement>("Your reply (required)").value).toBe(
        "Still drafting my answer about the event type."
      );
    });
  });
});
