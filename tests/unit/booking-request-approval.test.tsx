import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { BookingRequestDetailsPage } from "#/features/venue-requests/components/booking-request-details-page";
import { BookingRequestQueuePage } from "#/features/venue-requests/components/booking-request-queue-page";
import { VENUE_REQUEST_DECIDED_MESSAGE } from "#/features/venue-requests/schema";
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
vi.mock("#/features/venue-requests/server-fns", () => ({
  approveVenueRequest,
  rejectVenueRequest: vi.fn<() => Promise<unknown>>(),
}));
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
  venueId: 3,
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

// Opening the dialog is not the decision: nothing may run until Confirm is clicked.
async function confirmApproveDialog() {
  await userEvent.click(screen.getByRole("button", { name: /Approve request for Orchid Room/ }));
  expect(approveVenueRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
}

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

  it("confirms the row that was clicked, not the first row", async () => {
    render(
      <BookingRequestQueuePage
        user={venueStaff}
        requests={[queued, { ...queued, id: "request-002", venueName: "Harbour Hall" }]}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Approve request for Harbour Hall/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-002" } });
  });

  it("approves the row's request, confirms it naming the start, and returns to the queue", async () => {
    render(<BookingRequestQueuePage user={venueStaff} requests={[queued]} />);

    await confirmApproveDialog();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/venue-requests" }));
    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-001" } });
    expect(success).toHaveBeenCalledWith(
      "Booking approved for Orchid Room from 18 Nov 2030, 09:30."
    );
    // navigate already reruns the destination loaders; a trailing invalidate would reload it twice.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("asks for confirmation naming the venue and window before approving", async () => {
    render(<BookingRequestQueuePage user={venueStaff} requests={[queued]} />);

    await userEvent.click(screen.getByRole("button", { name: /Approve request for Orchid Room/ }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Orchid Room on 18 Nov 2030, 09:30 – 12:00");
    expect(dialog.textContent).toContain(
      "Approving holds the venue for that period and notifies the requesting Coordinator."
    );
    expect(approveVenueRequest).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(approveVenueRequest).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the server's refusal, naming the conflicting period, stays put and reloads the queue", async () => {
    approveVenueRequest.mockRejectedValue(
      new Error("Orchid Room is already booked 18 Nov 2030, 09:00 – 10:00")
    );
    render(
      <BookingRequestQueuePage user={venueStaff} requests={[{ ...queued, conflict: true }]} />
    );

    await confirmApproveDialog();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Orchid Room is already booked 18 Nov 2030, 09:00 – 10:00"
    );
    expect(success).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The request is still pending after this refusal, so reloading is safe and lets the
    // "Conflicting booking" badge catch up.
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("keeps the refusal on screen instead of reloading when the row was already decided elsewhere", async () => {
    approveVenueRequest.mockRejectedValue(new Error(VENUE_REQUEST_DECIDED_MESSAGE));
    render(<BookingRequestQueuePage user={venueStaff} requests={[queued]} />);

    await confirmApproveDialog();

    // Reloading here would either 404 the detail route or drop the row from the queue, taking the
    // alert down with it before it can be read.
    expect((await screen.findByRole("alert")).textContent).toBe(VENUE_REQUEST_DECIDED_MESSAGE);
    expect(invalidate).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("maps a bare refusal to the friendly fallback instead of the raw server text", async () => {
    approveVenueRequest.mockRejectedValue(new Error("Forbidden"));
    render(<BookingRequestQueuePage user={venueStaff} requests={[queued]} />);

    await confirmApproveDialog();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not approve this request. Try again."
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("demotes the approve control on a row already flagged conflicting", () => {
    render(
      <BookingRequestQueuePage user={venueStaff} requests={[{ ...queued, conflict: true }]} />
    );

    const button = screen.getByRole("button", { name: /Approve request for Orchid Room/ });
    expect(button.className).toContain("border-input");
  });

  it("offers no approval on an empty queue", () => {
    render(<BookingRequestQueuePage user={venueStaff} requests={[]} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("approves from the request's detail page and returns to the queue", async () => {
    render(<BookingRequestDetailsPage user={venueStaff} request={detail} venues={[]} />);

    await confirmApproveDialog();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/venue-requests" }));
    expect(approveVenueRequest).toHaveBeenCalledWith({ data: { id: "request-001" } });
    expect(success).toHaveBeenCalledWith(
      "Booking approved for Orchid Room from 18 Nov 2030, 09:30."
    );
  });

  it("offers the approval only to a role that may decide, on the queue", () => {
    render(<BookingRequestQueuePage user={coordinator} requests={[queued]} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();
  });

  it("offers the approval only to a role that may decide, on the detail page", () => {
    render(<BookingRequestDetailsPage user={coordinator} request={detail} venues={[]} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Record a decision" })).toBeNull();
  });

  it("no longer describes the detail page as read-only", () => {
    render(<BookingRequestDetailsPage user={venueStaff} request={detail} venues={[]} />);

    expect(screen.queryByText(/read-only/i)).toBeNull();
  });
});
