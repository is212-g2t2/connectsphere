// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventPageData } from "#/features/events/page-data";
import { safetyReReviewSections } from "#/features/safety-reviews/components/safety-review-sections";
import { SAFETY_REVIEW_ALREADY_PENDING_MESSAGE } from "#/features/safety-reviews/schema";

const { requestSafetyReReview, invalidate, success } = vi.hoisted(() => ({
  requestSafetyReReview: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/safety-reviews/server-fns", () => ({ requestSafetyReReview }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

const data = {
  kind: "event",
  event: {
    access: "coordinator",
    event: {
      id: 7,
      name: "Demo Day",
      status: "planning",
      eventDate: "2030-11-18",
      startTime: "09:00",
      endTime: "17:00",
      safetyStage: { state: "rejected", current: true },
    },
  },
} satisfies EventPageData;

function renderAction() {
  const section = safetyReReviewSections(data).find(
    candidate => candidate.id === "safety-re-review"
  );
  if (!section) throw new Error("Expected the safety re-review section");
  render(<>{section.render(data)}</>);
}

describe("the safety re-review action (PTR-158)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("asks the server for a fresh review of this event", async () => {
    requestSafetyReReview.mockResolvedValue({ reviewId: 9, eventId: 7 });
    const user = userEvent.setup();
    renderAction();

    await user.click(screen.getByRole("button", { name: "Request safety re-review" }));

    await waitFor(() => expect(requestSafetyReReview).toHaveBeenCalledWith({ data: { id: 7 } }));
    expect(success).toHaveBeenCalledWith(
      "Safety re-review requested. Every Safety Officer will be notified."
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows the server's named refusal and re-reads the page", async () => {
    requestSafetyReReview.mockRejectedValue(new Error(SAFETY_REVIEW_ALREADY_PENDING_MESSAGE));
    const user = userEvent.setup();
    renderAction();

    await user.click(screen.getByRole("button", { name: "Request safety re-review" }));

    const [alert] = await screen.findAllByRole("alert");
    expect(alert.textContent).toContain(SAFETY_REVIEW_ALREADY_PENDING_MESSAGE);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
