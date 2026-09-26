import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { BookingRequestDetailsPage } from "#/features/venue-requests/components/booking-request-details-page";
import { BookingRequestQueuePage } from "#/features/venue-requests/components/booking-request-queue-page";
import type {
  PendingVenueRequest,
  PendingVenueRequestDetail,
} from "#/features/venue-requests/server-fns";

const { approveVenueRequest, navigate, invalidate, success } = vi.hoisted(() => ({
  approveVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));
vi.mock("#/features/venue-requests/server-fns", () => ({ approveVenueRequest }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { requestId: string };
    "aria-label"?: string;
  }) => (
    <a href={params ? to.replace("$requestId", params.requestId) : to} aria-label={ariaLabel}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate, invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

const venueStaff: SessionUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Sam",
  role: "venue_staff",
};
// Holds no `venue_request:decide`, so the same pages must not offer the verb.
const coordinator: SessionUser = { ...venueStaff, id: "coord-1", role: "event_coordinator" };

const queued: PendingVenueRequest = {
  id: "request-001",
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: false,
};

const detail: PendingVenueRequestDetail = {
  ...queued,
  requirements: {
    eventTiming: "18 Nov 2030, 09:30 – 12:00",
    expectedAttendance: 85,
    layout: "Cabaret",
    accessibility: "",
    requiredFacilities: "",
  },
};

beforeEach(() => {
  approveVenueRequest.mockReset().mockResolvedValue({});
  navigate.mockReset().mockResolvedValue();
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
});

describe("approving a booking from the queue (PTR-33 AC1)", () => {
  it("offers an approval on each queue row, named by venue and start", () => {
    render(
      <BookingRequestQueuePage
        user={venueStaff}
        requests={[queued, { ...queued, id: "request-002", venueName: "Harbour Hall" }]}
      />
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(
      within(rows[0]).getByRole("button", {
        name: "Approve request for Orchid Room, 18 Nov 2030, 09:30",
      })
    ).toBeTruthy();
    expect(
      within(rows[1]).getByRole("button", { name: /Approve request for Harbour Hall/ })
    ).toBeTruthy();
  });

  it("approves the row's request, confirms it and reloads the queue", async () => {
    render(<BookingRequestQueuePage user={venueStaff} requests={[queued]} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve request for Orchid Room/ }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-001" } });
    expect(success).toHaveBeenCalledWith("Booking approved for Orchid Room.");
    expect(navigate).toHaveBeenCalledWith({ to: "/venue-requests" });
  });

  it("shows the server's refusal, naming the conflicting period, stays put and reloads the queue", async () => {
    approveVenueRequest.mockRejectedValue(
      new Error("Orchid Room is already booked 18 Nov 2030, 09:00 – 10:00")
    );
    render(
      <BookingRequestQueuePage user={venueStaff} requests={[{ ...queued, conflict: true }]} />
    );

    await userEvent.click(screen.getByRole("button", { name: /Approve request for Orchid Room/ }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Orchid Room is already booked 18 Nov 2030, 09:00 – 10:00"
    );
    expect(success).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // Another member of staff may have decided the row, so the loader reruns.
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("offers no approval on an empty queue", () => {
    render(<BookingRequestQueuePage user={venueStaff} requests={[]} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("approves from the request's detail page and returns to the queue", async () => {
    render(<BookingRequestDetailsPage user={venueStaff} request={detail} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve request for Orchid Room/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/venue-requests" }));
    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-001" } });
    expect(success).toHaveBeenCalledWith("Booking approved for Orchid Room.");
  });

  it("offers the approval only to a role that may decide, on the queue", () => {
    render(<BookingRequestQueuePage user={coordinator} requests={[queued]} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();
  });

  it("offers the approval only to a role that may decide, on the detail page", () => {
    render(<BookingRequestDetailsPage user={coordinator} request={detail} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Record a decision" })).toBeNull();
  });

  it("no longer describes the detail page as read-only", () => {
    render(<BookingRequestDetailsPage user={venueStaff} request={detail} />);

    expect(screen.queryByText(/read-only/i)).toBeNull();
  });
});
