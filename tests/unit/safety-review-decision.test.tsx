// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { safetySections } from "#/features/safety-reviews/components/safety-review-sections";
import { SAFETY_REVIEW_COMMENTS_REQUIRED_MESSAGE } from "#/features/safety-reviews/schema";
import type { EventPageData } from "#/features/events/page-data";

const { decideSafetyReview, invalidate, success } = vi.hoisted(() => ({
  decideSafetyReview: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/safety-reviews/server-fns", () => ({ decideSafetyReview }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

const data = {
  kind: "event",
  viewerId: "safety-1",
  event: {
    access: "safety_officer",
    event: {
      id: 7,
      name: "Demo Day",
      status: "approved",
      eventDate: "2030-11-18",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 100,
      layout: "Theatre",
      accessibilityRequirements: "",
      requiredFacilities: "",
      venue: null,
      venueCapacity: 200,
      sessionRequirements: null,
      equipment: [],
    },
  },
  safetyReview: {
    id: 3,
    state: "pending",
    fingerprint: "rendered-fingerprint",
    comments: null,
    decidedByName: null,
    decidedAt: null,
    createdAt: "2026-10-19T00:00:00.000Z",
    current: true,
  },
} satisfies EventPageData;

function renderDecisionForm() {
  const section = safetySections(data).find(candidate => candidate.id === "safety-review");
  if (!section) throw new Error("Expected the safety review section");
  render(<>{section.render(data)}</>);
}

describe("the safety review decision form (PTR-146)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("refuses a rejection without comments and does not call the server", async () => {
    const user = userEvent.setup();
    renderDecisionForm();

    await user.click(screen.getByRole("button", { name: "Reject this safety review" }));

    expect(await screen.findByText(SAFETY_REVIEW_COMMENTS_REQUIRED_MESSAGE)).toBeTruthy();
    expect(decideSafetyReview).not.toHaveBeenCalled();
  });

  it("records an approval with the fingerprint the page rendered", async () => {
    decideSafetyReview.mockResolvedValue({ reviewId: 3, eventId: 7, state: "approved" });
    const user = userEvent.setup();
    renderDecisionForm();

    await user.click(screen.getByRole("button", { name: "Approve this safety review" }));

    await waitFor(() =>
      expect(decideSafetyReview).toHaveBeenCalledWith({
        data: {
          reviewId: 3,
          decision: "approved",
          fingerprint: "rendered-fingerprint",
          comments: "",
        },
      })
    );
    expect(success).toHaveBeenCalledWith("Safety review decision recorded.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("sends the comments with a change request", async () => {
    decideSafetyReview.mockResolvedValue({ reviewId: 3, eventId: 7, state: "changes_requested" });
    const user = userEvent.setup();
    renderDecisionForm();

    await user.type(screen.getByLabelText("Decision comments"), "Add a second exit");
    await user.click(screen.getByRole("button", { name: "Request changes this safety review" }));

    await waitFor(() =>
      expect(decideSafetyReview).toHaveBeenCalledWith({
        data: {
          reviewId: 3,
          decision: "changes_requested",
          fingerprint: "rendered-fingerprint",
          comments: "Add a second exit",
        },
      })
    );
  });

  it("shows the server's named refusal beside the form and re-reads the page", async () => {
    decideSafetyReview.mockRejectedValue(
      new Error("Arrangements changed since you opened this review.")
    );
    const user = userEvent.setup();
    renderDecisionForm();

    await user.click(screen.getByRole("button", { name: "Approve this safety review" }));

    const [alert] = await screen.findAllByRole("alert");
    expect(alert.textContent).toContain("Arrangements changed since you opened this review.");
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
