// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { SafetyReviewsPage } from "#/features/safety-reviews/components/safety-reviews-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/events/7">{children}</a>,
}));

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
