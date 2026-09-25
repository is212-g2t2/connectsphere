import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BookingRequestQueue } from "#/features/venue-requests/components/booking-request-queue";
import type { PendingBookingRequest } from "#/features/venue-requests/server-fns";

// The queue links rather than callbacks; the mock substitutes the route params the way
// coordination-page.test.tsx does, and passes className and aria-label through to the anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { requestId: string };
    className?: string;
    "aria-label"?: string;
  }) => (
    <a
      href={params ? to.replace("$requestId", params.requestId) : to}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  ),
}));

const firstRequest: PendingBookingRequest = {
  id: "request-001",
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: true,
};

const secondRequest: PendingBookingRequest = {
  id: "request-002",
  venueName: "Harbour Hall",
  startsAt: "2030-11-18T13:00",
  endsAt: "2030-11-18T15:30",
  submittedAt: new Date("2030-11-01T02:00:00Z"),
  conflict: false,
};

describe("BookingRequestQueue component slice (PTR-32)", () => {
  it("shows an empty-state message when no pending requests are supplied (TC02)", () => {
    render(<BookingRequestQueue pendingRequestsOldestFirst={[]} />);

    expect(screen.getByText("No pending booking requests.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders all 53 supplied requests (TC10)", () => {
    const requests = Array.from({ length: 53 }, (_, index) => ({
      ...firstRequest,
      id: `request-${String(index + 1).padStart(3, "0")}`,
      venueName: `Venue ${index + 1}`,
    }));

    render(<BookingRequestQueue pendingRequestsOldestFirst={requests} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(53);
    for (const request of requests) {
      expect(screen.getByText(request.venueName)).toBeTruthy();
    }
  });

  it("preserves the caller's oldest-first order, including equal submission times (TC03, TC11; render-only)", () => {
    const oldestRequest: PendingBookingRequest = {
      ...firstRequest,
      id: "request-z",
      venueName: "Late booking, oldest submission",
      startsAt: "2031-01-05T09:30",
      endsAt: "2031-01-05T12:00",
      submittedAt: new Date("2030-10-31T01:00:00Z"),
    };
    // The equal-time requests deliberately reverse lexical id order.
    const pendingRequestsOldestFirst = Object.freeze([oldestRequest, secondRequest, firstRequest]);

    render(<BookingRequestQueue pendingRequestsOldestFirst={pendingRequestsOldestFirst} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Late booking, oldest submission")).toBeTruthy();
    expect(within(rows[1]).getByText("Harbour Hall")).toBeTruthy();
    expect(within(rows[2]).getByText("Orchid Room")).toBeTruthy();
    expect(pendingRequestsOldestFirst).toEqual([oldestRequest, secondRequest, firstRequest]);
  });

  it("does not mutate frozen request input (TC03, TC11; render-only)", () => {
    const pendingRequestsOldestFirst = Object.freeze([
      Object.freeze({ ...firstRequest }),
      Object.freeze({ ...secondRequest }),
    ]);

    expect(() =>
      render(<BookingRequestQueue pendingRequestsOldestFirst={pendingRequestsOldestFirst} />)
    ).not.toThrow();
    expect(pendingRequestsOldestFirst).toEqual([firstRequest, secondRequest]);
  });

  it("links each row to its request's detail page, named by venue (TC06)", () => {
    render(<BookingRequestQueue pendingRequestsOldestFirst={[firstRequest, secondRequest]} />);

    const orchid = screen.getByRole("link", { name: "Open request for Orchid Room" });
    expect(orchid.getAttribute("href")).toBe("/venue-requests/request-001");
    const harbour = screen.getByRole("link", { name: "Open request for Harbour Hall" });
    expect(harbour.getAttribute("href")).toBe("/venue-requests/request-002");
    // Opening is a plain navigation now: the queue renders links, not callback buttons.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows supplied venue, local requested times, and submission instant", () => {
    render(<BookingRequestQueue pendingRequestsOldestFirst={[firstRequest]} />);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Orchid Room")).toBeTruthy();
    expect(within(row).getByText("18 Nov 2030, 09:30")).toBeTruthy();
    expect(within(row).getByText("18 Nov 2030, 12:00")).toBeTruthy();
    const submission = within(row).getByText("1 Nov 2030, 09:00");
    expect(submission.tagName).toBe("TIME");
    expect(submission.getAttribute("dateTime")).toBe("2030-11-01T01:00:00.000Z");
  });

  it("flags only rows whose server result reports an approved-booking conflict (TC21)", () => {
    render(<BookingRequestQueue pendingRequestsOldestFirst={[firstRequest, secondRequest]} />);

    expect(screen.getByText("Overlaps approved booking")).toBeTruthy();
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Overlaps approved booking")
    ).toBeTruthy();
    expect(
      within(screen.getAllByRole("row")[2]).queryByText("Overlaps approved booking")
    ).toBeNull();
    expect(screen.queryByText(/another event|event name/i)).toBeNull();
  });
});
