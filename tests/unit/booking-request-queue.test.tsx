import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BookingRequestQueue } from "#/features/venue-requests/components/booking-request-queue";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";

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

const firstRequest: PendingVenueRequest = {
  id: "request-001",
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: true,
};

const secondRequest: PendingVenueRequest = {
  id: "request-002",
  venueName: "Harbour Hall",
  startsAt: "2030-11-18T13:00",
  endsAt: "2030-11-18T15:30",
  submittedAt: new Date("2030-11-01T02:00:00Z"),
  conflict: false,
};

describe("BookingRequestQueue component slice (PTR-32)", () => {
  it("shows an empty-state message when no pending requests are supplied (TC02)", () => {
    render(<BookingRequestQueue requests={[]} />);

    expect(screen.getByText("No pending booking requests.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders all 53 supplied requests (TC10)", () => {
    const requests = Array.from({ length: 53 }, (_, index) => ({
      ...firstRequest,
      id: `request-${String(index + 1).padStart(3, "0")}`,
      venueName: `Venue ${index + 1}`,
    }));

    render(<BookingRequestQueue requests={requests} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(53);
    for (const request of requests) {
      expect(screen.getByText(request.venueName)).toBeTruthy();
    }
  });

  it("preserves the caller's oldest-first order, including equal submission times (TC03, TC11; render-only)", () => {
    const oldestRequest: PendingVenueRequest = {
      ...firstRequest,
      id: "request-z",
      venueName: "Late booking, oldest submission",
      startsAt: "2031-01-05T09:30",
      endsAt: "2031-01-05T12:00",
      submittedAt: new Date("2030-10-31T01:00:00Z"),
    };
    // The equal-time requests deliberately reverse lexical id order. Rendering must read the array
    // without reordering it; an in-place reorder would throw on the frozen input under strict mode.
    const requests = Object.freeze([oldestRequest, secondRequest, firstRequest]);

    render(<BookingRequestQueue requests={requests} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Late booking, oldest submission")).toBeTruthy();
    expect(within(rows[1]).getByText("Harbour Hall")).toBeTruthy();
    expect(within(rows[2]).getByText("Orchid Room")).toBeTruthy();
  });

  it("links each row's venue to the request's detail page, named by venue and start (TC06)", () => {
    render(<BookingRequestQueue requests={[firstRequest, secondRequest]} />);

    // One link per row: the venue text carries the disambiguating accessible name.
    const orchid = screen.getByRole("link", {
      name: "Open request for Orchid Room, 18 Nov 2030, 09:30",
    });
    expect(orchid.getAttribute("href")).toBe("/venue-requests/request-001");
    expect(orchid.textContent).toBe("Orchid Room");
    const harbour = screen.getByRole("link", {
      name: "Open request for Harbour Hall, 18 Nov 2030, 13:00",
    });
    expect(harbour.getAttribute("href")).toBe("/venue-requests/request-002");
    expect(harbour.textContent).toBe("Harbour Hall");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    // Opening is a plain navigation now: the queue renders links, not callback buttons.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows supplied venue, local requested times, and submission instant", () => {
    render(<BookingRequestQueue requests={[firstRequest]} />);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Orchid Room")).toBeTruthy();
    expect(within(row).getByText("18 Nov 2030, 09:30")).toBeTruthy();
    expect(within(row).getByText("18 Nov 2030, 12:00")).toBeTruthy();
    const submission = within(row).getByText("1 Nov 2030, 09:00");
    expect(submission.tagName).toBe("TIME");
    expect(submission.getAttribute("dateTime")).toBe("2030-11-01T01:00:00.000Z");
  });

  it("flags only rows whose server result reports an approved-booking conflict and states a clear row (TC21)", () => {
    render(<BookingRequestQueue requests={[firstRequest, secondRequest]} />);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Conflicting booking")).toBeTruthy();
    expect(within(rows[1]).queryByText("No conflict")).toBeNull();
    expect(within(rows[2]).queryByText("Conflicting booking")).toBeNull();
    expect(within(rows[2]).getByText("No conflict")).toBeTruthy();
    expect(screen.queryByText(/another event|event name/i)).toBeNull();
  });
});
