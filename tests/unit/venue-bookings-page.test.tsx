import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VenueBookingsPage } from "#/features/venue-requests/components/venue-bookings-page";
import type { VenueBooking } from "#/features/venue-requests/server-fns";

const { amendVenueBooking, releaseVenueBooking, invalidate, success } = vi.hoisted(() => ({
  amendVenueBooking: vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(),
  releaseVenueBooking: vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/venue-requests/server-fns", () => ({
  amendVenueBooking,
  releaseVenueBooking,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

vi.mock("sonner", () => ({ toast: { success } }));

const booking: VenueBooking = {
  id: "booking-001",
  eventId: 44,
  eventName: "Annual partner summit",
  venueId: 3,
  venueName: "Orchid Room",
  assignedStaffId: "venue-staff-001",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
};

const venues = [
  { id: 3, name: "Orchid Room" },
  { id: 4, name: "Harbour Hall" },
];

beforeEach(() => {
  amendVenueBooking.mockReset().mockResolvedValue({});
  releaseVenueBooking.mockReset().mockResolvedValue({});
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
});

describe("VenueBookingsPage (PTR-37)", () => {
  it("lists booking details and exposes release and amend actions (AC1)", () => {
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    expect(screen.getByRole("heading", { name: "Annual partner summit" })).toBeTruthy();
    expect(screen.getByText("Orchid Room · 18 Nov 2030, 09:30 – 12:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release Annual partner summit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Amend Annual partner summit" })).toBeTruthy();
  });

  it("requires a release reason before calling the server (AC2)", async () => {
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Release Annual partner summit" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm release" }));

    expect(await screen.findByText("Enter a reason to release this booking")).toBeTruthy();
    expect(releaseVenueBooking).not.toHaveBeenCalled();
  });

  it("submits a release reason and reloads the booking list (AC2, AC4)", async () => {
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Release Annual partner summit" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Reason for release" }),
      "Floor repair"
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm release" }));

    await waitFor(() => expect(releaseVenueBooking).toHaveBeenCalledOnce());
    expect(releaseVenueBooking).toHaveBeenCalledWith({
      data: { id: booking.id, reason: "Floor repair" },
    });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith("Booking released for Annual partner summit.");
  });

  it("shows a release refusal at form level without blaming a valid reason", async () => {
    releaseVenueBooking.mockRejectedValueOnce(
      new Error("Only an approved booking can be released or amended.")
    );
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Release Annual partner summit" }));
    const reason = screen.getByRole("textbox", { name: "Reason for release" });
    await userEvent.type(reason, "Floor repair");
    await userEvent.click(screen.getByRole("button", { name: "Confirm release" }));

    expect(
      await screen.findByText("Only an approved booking can be released or amended.")
    ).toBeTruthy();
    expect(reason.getAttribute("aria-invalid")).toBe("false");
  });

  it("submits an amendment with the selected venue and period (AC3)", async () => {
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Amend Annual partner summit" }));
    await userEvent.selectOptions(screen.getByLabelText("Venue"), "4");
    await userEvent.clear(screen.getByLabelText("Date"));
    await userEvent.type(screen.getByLabelText("Date"), "2030-11-19");
    await userEvent.clear(screen.getByLabelText("Start time"));
    await userEvent.type(screen.getByLabelText("Start time"), "10:00");
    await userEvent.clear(screen.getByLabelText("End time"));
    await userEvent.type(screen.getByLabelText("End time"), "13:30");
    await userEvent.click(screen.getByRole("button", { name: "Save amendment" }));

    await waitFor(() => expect(amendVenueBooking).toHaveBeenCalledOnce());
    expect(amendVenueBooking).toHaveBeenCalledWith({
      data: {
        id: booking.id,
        venueId: 4,
        date: "2030-11-19",
        startTime: "10:00",
        endTime: "13:30",
      },
    });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith("Booking amended for Annual partner summit.");
  });

  it("marks amendment controls invalid when the server refuses the change", async () => {
    amendVenueBooking.mockRejectedValueOnce(new Error("The selected period conflicts."));
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-001" />
    );

    await userEvent.click(screen.getByRole("button", { name: "Amend Annual partner summit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save amendment" }));

    expect(await screen.findByText("The selected period conflicts.")).toBeTruthy();
    for (const name of ["Venue", "Date", "Start time", "End time"]) {
      expect(screen.getByLabelText(name).getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("identifies bookings owned by another staff member without exposing actions", () => {
    render(
      <VenueBookingsPage bookings={[booking]} venues={venues} currentStaffId="venue-staff-002" />
    );

    expect(screen.getByText("Managed by another Venue Staff member.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Release Annual partner summit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Amend Annual partner summit" })).toBeNull();
  });

  it("exposes actions when a deleted approver left the booking unassigned", () => {
    render(
      <VenueBookingsPage
        bookings={[{ ...booking, assignedStaffId: null }]}
        venues={venues}
        currentStaffId="venue-staff-002"
      />
    );

    expect(screen.getByRole("button", { name: "Release Annual partner summit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Amend Annual partner summit" })).toBeTruthy();
  });
});
