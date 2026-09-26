import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { BookingRequestDetailsPage } from "#/features/venue-requests/components/booking-request-details-page";
import {
  VENUE_REJECTION_REASON_REQUIRED,
  VENUE_REJECTION_TIME_PAIR_MESSAGE,
} from "#/features/venue-requests/schema";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

const { approveVenueRequest, rejectVenueRequest, navigate, invalidate, success } = vi.hoisted(
  () => ({
    approveVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
    rejectVenueRequest: vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(),
    navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
  })
);
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
vi.mock("sonner", () => ({ toast: { success } }));

const venueStaff: SessionUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Sam",
  role: "venue_staff",
};
const coordinator: SessionUser = { ...venueStaff, id: "coord-1", role: "event_coordinator" };

const detail: PendingVenueRequestDetail = {
  id: "request-001",
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: false,
  requirements: {
    eventTiming: "18 Nov 2030, 09:30 – 12:00",
    expectedAttendance: 85,
    layout: "Cabaret",
    accessibility: "",
    requiredFacilities: "",
  },
};

const venues = [
  { id: 3, name: "Orchid Room" },
  { id: 4, name: "Harbour Hall" },
];

function renderPage(user: SessionUser = venueStaff) {
  return render(<BookingRequestDetailsPage user={user} request={detail} venues={venues} />);
}

const reasonBox = () => screen.getByRole("textbox", { name: /Reason for rejection/ });
const rejectButton = () => screen.getByRole("button", { name: "Reject request" });

beforeEach(() => {
  approveVenueRequest.mockReset().mockResolvedValue({});
  rejectVenueRequest.mockReset().mockResolvedValue({});
  navigate.mockReset().mockResolvedValue();
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
});

describe("rejecting a booking from the request's detail page (PTR-34)", () => {
  it("offers the rejection form only to a role that may decide", () => {
    renderPage(coordinator);

    expect(screen.queryByRole("button", { name: "Reject request" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("asks for a reason, and offers an optional suggested venue, date and times (AC1, AC2)", () => {
    renderPage();

    expect(reasonBox()).toBeTruthy();
    expect(screen.getByLabelText("Suggested venue")).toBeTruthy();
    expect(screen.getByLabelText("Suggested date")).toBeTruthy();
    expect(screen.getByLabelText("Suggested start time")).toBeTruthy();
    expect(screen.getByLabelText("Suggested end time")).toBeTruthy();
    const options = screen.getAllByRole("option").map(option => option.textContent);
    expect(options).toEqual(["No suggested venue", "Orchid Room", "Harbour Hall"]);
  });

  it("refuses a rejection without a reason and does not call the server (AC1)", async () => {
    renderPage();

    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_REASON_REQUIRED)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only reason (AC1)", async () => {
    renderPage();

    await userEvent.type(reasonBox(), "   ");
    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_REASON_REQUIRED)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("rejects with a reason alone, sending no suggestion, and returns to the queue (AC1)", async () => {
    renderPage();

    await userEvent.type(reasonBox(), "Closed for floor resurfacing");
    await userEvent.click(rejectButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/venue-requests" }));
    expect(rejectVenueRequest).toHaveBeenCalledWith({
      data: { id: "request-001", reason: "Closed for floor resurfacing" },
    });
    expect(success).toHaveBeenCalledWith("Booking rejected for Orchid Room.");
  });

  it("sends a full suggestion with the reason (AC2)", async () => {
    renderPage();

    await userEvent.type(reasonBox(), "Closed for floor resurfacing");
    await userEvent.selectOptions(screen.getByLabelText("Suggested venue"), "4");
    fireEvent.change(screen.getByLabelText("Suggested date"), { target: { value: "2030-11-19" } });
    fireEvent.change(screen.getByLabelText("Suggested start time"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Suggested end time"), { target: { value: "13:30" } });
    await userEvent.click(rejectButton());

    await waitFor(() => expect(rejectVenueRequest).toHaveBeenCalledOnce());
    expect(rejectVenueRequest).toHaveBeenCalledWith({
      data: {
        id: "request-001",
        reason: "Closed for floor resurfacing",
        suggestedVenueId: 4,
        suggestedDate: "2030-11-19",
        suggestedStartTime: "10:00",
        suggestedEndTime: "13:30",
      },
    });
  });

  it("refuses a suggested start time without an end time (AC2)", async () => {
    renderPage();

    await userEvent.type(reasonBox(), "Closed");
    fireEvent.change(screen.getByLabelText("Suggested start time"), { target: { value: "10:00" } });
    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_TIME_PAIR_MESSAGE)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, stays put and reloads the queue's data", async () => {
    rejectVenueRequest.mockRejectedValue(new Error("This request has already been decided."));
    renderPage();

    await userEvent.type(reasonBox(), "Closed");
    await userEvent.click(rejectButton());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This request has already been decided."
    );
    expect(success).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
