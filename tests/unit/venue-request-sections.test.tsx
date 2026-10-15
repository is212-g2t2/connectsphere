// @vitest-environment jsdom
import { Fragment } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventPageData } from "#/features/events/page-data";
import { venueRequestSections } from "#/features/venue-requests/components/venue-request-sections";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

const { approveVenueRequest, rejectVenueRequest, navigate, invalidate, success, error } =
  vi.hoisted(() => ({
    approveVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
    rejectVenueRequest:
      vi.fn<(input: { data: { id: string; reason: string } }) => Promise<unknown>>(),
    navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }));
vi.mock("#/features/venue-requests/server-fns", () => ({
  approveVenueRequest,
  rejectVenueRequest,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ navigate, invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, error } }));

const pending: PendingVenueRequestDetail = {
  id: "request-001",
  venueId: 3,
  venueName: "Riverside Loft",
  startsAt: "2026-11-21T18:00",
  endsAt: "2026-11-21T22:00",
  submittedAt: new Date("2026-10-14T01:00:00Z"),
  conflict: "booking",
  requirements: {
    eventTiming: "21 Nov 2026, 18:00–22:00",
    expectedAttendance: 120,
    layout: "Cabaret",
    accessibilityRequirements: "Step-free entrance; quiet room available",
    requiredFacilities: "6 power drops, WiFi",
  },
};

const secondPending: PendingVenueRequestDetail = {
  id: "request-002",
  venueId: 4,
  venueName: "Harbor Hall",
  startsAt: "2026-11-22T10:00",
  endsAt: "2026-11-22T12:00",
  submittedAt: new Date("2026-10-14T02:00:00Z"),
  conflict: null,
  requirements: {
    eventTiming: "22 Nov 2026, 10:00–12:00",
    expectedAttendance: 80,
    layout: "Theatre",
    accessibilityRequirements: "Step-free entrance",
    requiredFacilities: "PA system",
  },
};

/** A pending projection entry with no loaded request. */
const harborHallEntry = {
  id: "request-002",
  status: "pending",
  venueName: "Harbor Hall",
  date: "2026-11-22",
  startTime: "10:00",
  endTime: "12:00",
};

/** One projection entry for a loaded detail. Settled entries carry their outcome instead. */
function entryOf(detail: PendingVenueRequestDetail) {
  return {
    id: detail.id,
    status: "pending",
    venueName: detail.venueName,
    date: detail.startsAt.slice(0, 10),
    startTime: detail.startsAt.slice(11, 16),
    endTime: detail.endsAt.slice(11, 16),
  };
}

function page(input: {
  details?: PendingVenueRequestDetail[];
  entries?: unknown[];
  status?: string;
  /** The batched request read failed, so the loader set no `venueDecisions`. */
  readFailed?: boolean;
}): EventPageData {
  const details = input.details ?? [];
  return {
    kind: "event",
    event: {
      access: "venue_staff",
      event: {
        id: 1042,
        eventDate: "2026-11-21",
        startTime: "18:00",
        endTime: "22:00",
        status: input.status ?? "planning",
        venueRequests: input.entries ?? details.map(entryOf),
      },
    },
    venueDecisions: input.readFailed
      ? undefined
      : {
          requests: details,
          venues: [
            { id: 3, name: "Riverside Loft" },
            { id: 4, name: "Harbor Hall" },
          ],
        },
  } as unknown as EventPageData;
}

function renderSection(data: EventPageData, id: string) {
  cleanup();
  const section = venueRequestSections(data)
    .filter(candidate => candidate.visible(data))
    .find(candidate => candidate.id === id);
  expect(section).toBeDefined();
  render(<>{section?.render(data)}</>);
}

beforeEach(() => {
  approveVenueRequest.mockReset().mockResolvedValue({});
  rejectVenueRequest.mockReset().mockResolvedValue({});
  navigate.mockReset().mockResolvedValue();
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
});

describe("venueRequestSections", () => {
  it("renders the pending request details with the decision controls", () => {
    const data = page({ details: [pending] });

    renderSection(data, "request");
    expect(
      screen.getByRole("heading", { name: /Booking request details: Riverside Loft/ })
    ).toBeTruthy();
    expect(screen.getByText("Conflicting booking")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();

    renderSection(data, "decision");
    expect(screen.getByRole("heading", { name: "Record a decision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve request for Riverside Loft/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject request for Riverside Loft/ })).toBeTruthy();
    expect(screen.getByLabelText("Reason for rejection (required)")).toBeTruthy();
    expect(screen.getByRole("form", { name: /Reject request for Riverside Loft/ })).toBeTruthy();
  });

  it("shows a conflicting request's badge once across the staff page", () => {
    const data = page({ details: [pending] });
    const sections = venueRequestSections(data).filter(section => section.visible(data));
    render(
      <>
        {sections.map(section => (
          <Fragment key={section.id}>{section.render(data)}</Fragment>
        ))}
      </>
    );

    expect(screen.getAllByText("Conflicting booking")).toHaveLength(1);
  });

  it("renders one details block and one decision group per pending request, with unique ids", () => {
    const data = page({ details: [pending, secondPending] });

    renderSection(data, "request");
    expect(screen.getAllByRole("heading", { name: /Booking request details/ })).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: /Booking request details: Riverside Loft/ })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Booking request details: Harbor Hall/ })
    ).toBeTruthy();
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(screen.getByText("Riverside Loft")).toBeTruthy();
    expect(screen.getByText("Harbor Hall")).toBeTruthy();

    renderSection(data, "decision");
    expect(
      screen.getByRole("heading", { name: /Riverside Loft, 21 Nov 2026, 18:00/ })
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Harbor Hall, 22 Nov 2026, 10:00/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Approve request/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Reject request for/ })).toHaveLength(2);
    expect(screen.getAllByRole("form", { name: /Reject request for/ })).toHaveLength(2);
    expect(screen.getAllByLabelText("Reason for rejection (required)")).toHaveLength(2);
    expect(document.getElementById("rejection-reason-request-001")).toBeTruthy();
    expect(document.getElementById("rejection-reason-request-002")).toBeTruthy();

    const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("submits each group's own request id when approving or rejecting", async () => {
    renderSection(page({ details: [pending, secondPending] }), "decision");

    // Reject from the first group. Its form submits the first request only.
    const firstForm = screen.getByRole("form", { name: /Reject request for Riverside Loft/ });
    await userEvent.type(
      within(firstForm).getByRole("textbox", { name: /Reason for rejection/ }),
      "Closed for floor resurfacing"
    );
    await userEvent.click(
      within(firstForm).getByRole("button", { name: /Reject request for Riverside Loft/ })
    );
    await waitFor(() => expect(rejectVenueRequest).toHaveBeenCalledOnce());
    expect(rejectVenueRequest).toHaveBeenCalledWith({
      data: { id: "request-001", reason: "Closed for floor resurfacing" },
    });

    // Approve from the second group. Its button submits the second request only.
    await userEvent.click(screen.getByRole("button", { name: /Approve request for Harbor Hall/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(approveVenueRequest).toHaveBeenCalledOnce());
    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-002" } });
  });

  it("says a pending entry missing from a loaded read was decided after the page loaded", () => {
    const data = page({
      details: [pending],
      entries: [entryOf(pending), harborHallEntry],
    });

    renderSection(data, "request");
    expect(
      screen.getByRole("heading", {
        name: "Booking request details: Harbor Hall, 22 Nov 2026, 10:00 – 12:00",
      })
    ).toBeTruthy();
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(
      screen.getByText(
        "This request was decided after the page loaded. Reload the page to see the outcome."
      )
    ).toBeTruthy();
    expect(screen.queryByText(/did not load/)).toBeNull();

    renderSection(data, "decision");
    expect(screen.getAllByRole("button", { name: /Approve request/ })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /Harbor Hall/ })).toBeNull();
    expect(screen.getAllByLabelText("Reason for rejection (required)")).toHaveLength(1);
    expect(document.getElementById("rejection-reason-request-002")).toBeNull();
  });

  it("says every pending entry did not load when the read failed", () => {
    const data = page({
      readFailed: true,
      entries: [entryOf(pending), harborHallEntry],
    });

    renderSection(data, "request");
    expect(
      screen.getAllByText("The full request did not load. Reload the page to decide it.")
    ).toHaveLength(2);
    expect(screen.queryByText(/decided after the page loaded/)).toBeNull();

    expect(
      venueRequestSections(data)
        .filter(section => section.visible(data))
        .map(section => section.id)
    ).toEqual(["request", "decision"]);
    renderSection(data, "decision");
    expect(
      screen.getByText("The full request did not load. Reload the page to decide it.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
    expect(screen.queryByLabelText("Reason for rejection (required)")).toBeNull();
  });

  it("says in the decision section when every pending request was decided after load", () => {
    const data = page({ details: [], entries: [entryOf(pending), harborHallEntry] });

    renderSection(data, "decision");
    expect(
      screen.getByText(
        "These requests were decided after the page loaded. Reload the page to see the outcome."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();

    renderSection(page({ details: [], entries: [harborHallEntry] }), "decision");
    expect(
      screen.getByText(
        "This request was decided after the page loaded. Reload the page to see the outcome."
      )
    ).toBeTruthy();
  });

  it("moves focus to the first remaining decision group after a decision", async () => {
    const data = page({ details: [pending, secondPending] });
    const decision = venueRequestSections(data).find(section => section.id === "decision");
    expect(decision).toBeDefined();
    const { rerender } = render(<>{decision?.render(data)}</>);

    await userEvent.click(
      screen.getByRole("button", { name: /Approve request for Riverside Loft/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());

    const remaining = page({ details: [secondPending] });
    rerender(<>{decision?.render(remaining)}</>);

    const heading = screen.getByRole("heading", { name: /Harbor Hall, 22 Nov 2026/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("refreshes the event page in place after an approval, without leaving for the queue", async () => {
    renderSection(page({ details: [pending] }), "decision");

    await userEvent.click(
      screen.getByRole("button", { name: /Approve request for Riverside Loft/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(
      "Booking approved for Riverside Loft from 21 Nov 2026, 18:00."
    );
  });

  it("renders the decided outcome with its banner, without the decision block", () => {
    const data = page({
      entries: [
        {
          id: "vr-1",
          status: "approved",
          venueName: "Harbor Hall",
          date: "2026-11-21",
          startTime: "18:00",
          endTime: "22:00",
        },
      ],
    });

    expect(
      venueRequestSections(data)
        .filter(section => section.visible(data))
        .map(section => section.id)
    ).toEqual(["request"]);

    renderSection(data, "request");
    // The heading names the venue and period. The card does not repeat them.
    expect(
      screen.getByRole("heading", {
        name: "Booking request details: Harbor Hall, 21 Nov 2026, 18:00 – 22:00",
      })
    ).toBeTruthy();
    expect(screen.getAllByText(/Harbor Hall/)).toHaveLength(1);
    expect(screen.getAllByText(/21 Nov 2026/)).toHaveLength(1);
    expect(screen.getByText("Booking approved.")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
  });

  it("hides the decision block when the event is cancelled", () => {
    const data = page({ details: [pending], status: "cancelled" });

    expect(
      venueRequestSections(data)
        .filter(section => section.visible(data))
        .map(section => section.id)
    ).toEqual(["request"]);
  });

  it("offers only the rejection once the event cannot take a new booking", () => {
    for (const status of ["confirmed", "completed", "rejected"]) {
      renderSection(page({ details: [pending], status }), "decision");

      expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
      expect(
        screen.getByText("This event cannot take a new booking. You can only reject this request.")
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Reject request for Riverside Loft/ })
      ).toBeTruthy();
    }

    renderSection(page({ details: [pending], status: "submitted" }), "decision");
    expect(screen.getByRole("button", { name: /Approve request for Riverside Loft/ })).toBeTruthy();
    expect(screen.queryByText(/cannot take a new booking/)).toBeNull();
  });

  it("gates the decision block on the visible data, not the built data", () => {
    const sections = venueRequestSections(page({ details: [pending], status: "planning" }));
    const decision = sections.find(section => section.id === "decision");
    expect(decision).toBeDefined();

    expect(decision?.visible(page({ details: [pending], status: "cancelled" }))).toBe(false);
    expect(decision?.visible(page({ details: [pending], status: "planning" }))).toBe(true);
  });

  it("shows the rejection reason and the suggested alternative", () => {
    const data = page({
      entries: [
        {
          id: "vr-1",
          status: "rejected",
          venueName: "Riverside Loft",
          date: "2026-11-21",
          startTime: "18:00",
          endTime: "22:00",
          rejection: {
            venueId: 3,
            reason: "Fully booked for a private hire that weekend.",
            suggestion: {
              venueName: "Harbor Hall",
              date: "2026-11-21",
              startTime: "18:00",
              endTime: "22:00",
            },
            suggestedVenueId: 4,
          },
        },
      ],
    });

    renderSection(data, "request");
    expect(screen.getByText("Request declined.")).toBeTruthy();
    expect(screen.getByText("Fully booked for a private hire that weekend.")).toBeTruthy();
    expect(screen.getByText(/Harbor Hall/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
  });

  it("shows the release banner with the release record", () => {
    const data = page({
      entries: [
        {
          id: "vr-1",
          status: "released",
          venueName: "Harbor Hall",
          date: "2026-11-21",
          startTime: "18:00",
          endTime: "22:00",
          release: {
            reason: "Organiser moved the event outdoors.",
            changedByName: "Priya Nair",
          },
        },
      ],
    });

    renderSection(data, "request");
    expect(screen.getByText("Booking released.")).toBeTruthy();
    expect(screen.getByText("Organiser moved the event outdoors.")).toBeTruthy();
    expect(screen.getByText("Priya Nair")).toBeTruthy();
  });
});
