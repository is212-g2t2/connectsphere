// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { SafetyReviewsPage } from "#/features/safety-reviews/components/safety-reviews-page";
import type { PendingSafetyReview } from "#/features/safety-reviews/schema";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/events/7">{children}</a>,
}));

const currentReview: PendingSafetyReview = {
  id: 1,
  eventId: 7,
  eventName: "Demo Day",
  eventStatus: "planning",
  venue: null,
  createdAt: "2030-01-01T00:00:00Z",
  current: true,
  updated: false,
};

const withdrawnReview: PendingSafetyReview = {
  id: 2,
  eventId: 8,
  eventName: "Night Market",
  eventStatus: "approved",
  venue: null,
  createdAt: "2030-01-02T00:00:00Z",
  current: false,
  updated: true,
};

test.each([
  { current: true, updated: false, label: "Awaiting decision" },
  { current: true, updated: true, label: "Updated" },
  { current: false, updated: true, label: "Withdrawn: arrangements changed" },
])("shows $label for the pending review", ({ current, updated, label }) => {
  render(
    <SafetyReviewsPage
      reviews={[
        {
          id: 1,
          eventId: 7,
          eventName: "Demo Day",
          eventStatus: "planning",
          venue: null,
          createdAt: "2030-01-01T00:00:00Z",
          current,
          updated,
        },
      ]}
    />
  );
  expect(screen.getByText(label)).toBeTruthy();
});

describe("SafetyReviewsPage queue", () => {
  test("counts the reviews", () => {
    render(<SafetyReviewsPage reviews={[currentReview, withdrawnReview]} />);
    expect(screen.getByText("2 safety reviews")).toBeTruthy();
  });

  test("filters current and withdrawn reviews", async () => {
    const user = userEvent.setup();
    render(<SafetyReviewsPage reviews={[currentReview, withdrawnReview]} />);

    await user.click(screen.getByLabelText("Review status"));
    await user.click(await screen.findByRole("option", { name: "Withdrawn" }));
    expect(screen.queryByText("Demo Day")).toBeNull();
    expect(screen.getByText("Night Market")).toBeTruthy();
    expect(screen.getByText("Showing 1 of 2 safety reviews")).toBeTruthy();

    await user.click(screen.getByLabelText("Review status"));
    await user.click(await screen.findByRole("option", { name: "Awaiting decision" }));
    expect(screen.getByText("Demo Day")).toBeTruthy();
    expect(screen.queryByText("Night Market")).toBeNull();
  });

  test("says when no review matches the filter", async () => {
    const user = userEvent.setup();
    render(<SafetyReviewsPage reviews={[currentReview]} />);

    await user.click(screen.getByLabelText("Review status"));
    await user.click(await screen.findByRole("option", { name: "Withdrawn" }));
    expect(screen.getByText("No reviews match this filter.")).toBeTruthy();
  });

  test("explains an empty queue with one dashboard action", () => {
    render(<SafetyReviewsPage reviews={[]} />);
    // The Empty state carries the reason and the action; the count line stays hidden.
    expect(screen.queryByText("0 safety reviews")).toBeNull();
    expect(screen.getByText("No events await a safety review.")).toBeTruthy();
    expect(
      screen.getByText(
        "Reviews appear here when an event's venue and technical arrangements are complete."
      )
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Back to dashboard" })).toHaveLength(1);
  });
});
