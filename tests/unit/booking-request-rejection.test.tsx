import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RejectBookingForm } from "#/features/venue-requests/components/reject-booking-form";
import {
  VENUE_REJECTION_REASON_REQUIRED,
  VENUE_REJECTION_TIME_PAIR_MESSAGE,
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
} from "#/features/venue-requests/schema";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

const { approveVenueRequest, rejectVenueRequest, navigate, invalidate, success, toastError } =
  vi.hoisted(() => ({
    approveVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
    rejectVenueRequest: vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(),
    navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
    toastError: vi.fn<(message: string) => void>(),
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
vi.mock("sonner", () => ({ toast: { success, error: toastError } }));

const detail: PendingVenueRequestDetail = {
  id: "request-001",
  eventId: 41,
  venueId: 3,
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: null,
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

function renderForm() {
  return render(<RejectBookingForm request={detail} venues={venues} />);
}

const reasonBox = () => screen.getByRole("textbox", { name: /Reason for rejection/ });
const rejectButton = () => screen.getByRole("button", { name: "Reject request" });

beforeEach(() => {
  approveVenueRequest.mockReset().mockResolvedValue({});
  rejectVenueRequest.mockReset().mockResolvedValue({});
  navigate.mockReset().mockResolvedValue();
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
  toastError.mockReset();
});

describe("rejecting a booking (PTR-34)", () => {
  it("asks for a reason, and offers an optional suggested venue, date and times (AC1, AC2)", async () => {
    renderForm();

    expect(reasonBox()).toBeTruthy();
    expect(screen.getByLabelText("Suggested venue").textContent).toContain("No suggested venue");
    expect(screen.getByLabelText("Suggested date")).toBeTruthy();
    expect(screen.getByLabelText("Suggested start time")).toBeTruthy();
    expect(screen.getByLabelText("Suggested end time")).toBeTruthy();

    await userEvent.click(screen.getByLabelText("Suggested venue"));
    const options = (await screen.findAllByRole("option")).map(option => option.textContent);
    expect(options).toEqual(["Harbour Hall"]);
  });

  it("excludes the request's own venue from the suggestion picker", async () => {
    renderForm();

    await userEvent.click(screen.getByLabelText("Suggested venue"));

    // Orchid Room (id 3) is the venue being rejected; suggesting it back makes no sense.
    expect(await screen.findByRole("option", { name: "Harbour Hall" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Orchid Room" })).toBeNull();
  });

  it("refuses a rejection without a reason and does not call the server (AC1)", async () => {
    renderForm();

    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_REASON_REQUIRED)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only reason (AC1)", async () => {
    renderForm();

    await userEvent.type(reasonBox(), "   ");
    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_REASON_REQUIRED)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("rejects with a reason alone, sending no suggestion, and returns to the queue (AC1)", async () => {
    renderForm();

    await userEvent.type(reasonBox(), "Closed for floor resurfacing");
    await userEvent.click(rejectButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
    expect(rejectVenueRequest).toHaveBeenCalledWith({
      data: { id: "request-001", reason: "Closed for floor resurfacing" },
    });
    expect(success).toHaveBeenCalledWith("Booking rejected for Orchid Room.");
  });

  it("sends a full suggestion with the reason (AC2)", async () => {
    renderForm();

    await userEvent.type(reasonBox(), "Closed for floor resurfacing");
    await userEvent.click(screen.getByLabelText("Suggested venue"));
    await userEvent.click(await screen.findByRole("option", { name: "Harbour Hall" }));
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
    renderForm();

    await userEvent.type(reasonBox(), "Closed");
    fireEvent.change(screen.getByLabelText("Suggested start time"), { target: { value: "10:00" } });
    await userEvent.click(rejectButton());

    expect(await screen.findByText(VENUE_REJECTION_TIME_PAIR_MESSAGE)).toBeTruthy();
    expect(rejectVenueRequest).not.toHaveBeenCalled();
  });

  it("shows an ordinary refusal, stays put and reloads the queue's data", async () => {
    rejectVenueRequest.mockRejectedValue(new Error("Forbidden"));
    renderForm();

    await userEvent.type(reasonBox(), "Closed");
    await userEvent.click(rejectButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Forbidden");
    expect(success).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  /**
   * A conflict means someone else already settled the row: reloading this page's loader would
   * 404 it out from under the form (PTR-34 review), so the refusal is toasted from the queue
   * instead of flashed on a page the router is about to replace. Both settle sentences take this
   * branch — rejected, and approved/withdrawn.
   */
  it.each([VENUE_REQUEST_DECIDED_MESSAGE, VENUE_REQUEST_REJECTED_MESSAGE])(
    "toasts and returns to the queue when someone else already settled the request (%s)",
    async message => {
      rejectVenueRequest.mockRejectedValue(new Error(message));
      renderForm();

      await userEvent.type(reasonBox(), "Closed");
      await userEvent.click(rejectButton());

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
      expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
      expect(success).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    }
  );
});
