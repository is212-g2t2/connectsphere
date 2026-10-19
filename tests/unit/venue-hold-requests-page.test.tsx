// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VenueHoldRequestsPage } from "#/features/venue-requests/components/venue-hold-requests-page";
import {
  VENUE_EVENT_STATUS_PHRASE,
  VENUE_HOLD_DECLINE_REASON_REQUIRED,
  VENUE_HOLD_REQUEST_HANDLED_MESSAGE,
} from "#/features/venue-requests/schema";
import type { VenueHoldRequest } from "#/features/venue-requests/server-fns";

const { mockInvalidate, mockPlace, mockDecline, mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn<(msg?: unknown) => void>(),
  mockInvalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockPlace: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
  mockDecline: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mockInvalidate }),
}));

vi.mock("#/features/venue-requests/server-fns", () => ({
  placeVenueHold: mockPlace,
  declineVenueHold: mockDecline,
  setVenueHoldExpiry: vi.fn<() => Promise<unknown>>(),
  setVenueHoldWarning: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn<(msg?: unknown) => void>(), error: mockToastError },
}));

const request: VenueHoldRequest = {
  id: "hold-1",
  venueName: "Harbour Hall",
  startsAt: "2099-06-15T09:00",
  endsAt: "2099-06-15T12:00",
  requestedAt: "2099-06-01T14:30",
};

/** PTR-150 AC2, AC3, AC5: the shared hold-request queue. */
describe("VenueHoldRequestsPage", () => {
  it("shows the venue, window and requested time of each request (AC2)", () => {
    render(<VenueHoldRequestsPage requests={[request]} />);
    const item = screen.getByRole("listitem", { name: "Harbour Hall" });
    expect(within(item).getByText("15 Jun 2099, 09:00 – 12:00")).toBeTruthy();
    expect(within(item).getByText("Requested 1 Jun 2099, 14:30")).toBeTruthy();
  });

  it("says when no request is waiting", () => {
    render(<VenueHoldRequestsPage requests={[]} />);
    expect(screen.getByText("No hold requests are waiting.")).toBeTruthy();
  });

  it("places a request with the expiry (AC3)", async () => {
    const user = userEvent.setup();
    render(<VenueHoldRequestsPage requests={[request]} />);
    await user.click(screen.getByRole("button", { name: "Place hold" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date and time"), "2099-06-10T12:00");
    await user.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() =>
      expect(mockPlace).toHaveBeenCalledWith({
        data: { id: "hold-1", expiresAt: "2099-06-10T12:00" },
      })
    );
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("requires a reason to decline, then sends it (AC5)", async () => {
    const user = userEvent.setup();
    render(<VenueHoldRequestsPage requests={[request]} />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(await screen.findByText(VENUE_HOLD_DECLINE_REASON_REQUIRED)).toBeTruthy();
    expect(mockDecline).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Reason for decline"), "Exams that week");
    await user.click(screen.getByRole("button", { name: "Confirm decline" }));
    await waitFor(() =>
      expect(mockDecline).toHaveBeenCalledWith({
        data: { id: "hold-1", reason: "Exams that week" },
      })
    );
  });

  it("toasts a decline refusal for a request that another member handled (AC6)", async () => {
    // The reload drops the handled request and its form, so only a toast can show the refusal.
    mockDecline.mockRejectedValueOnce(new Error(VENUE_HOLD_REQUEST_HANDLED_MESSAGE));
    const user = userEvent.setup();
    render(<VenueHoldRequestsPage requests={[request]} />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.type(screen.getByLabelText("Reason for decline"), "Exams that week");
    await user.click(screen.getByRole("button", { name: "Confirm decline" }));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(VENUE_HOLD_REQUEST_HANDLED_MESSAGE)
    );
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("toasts a placement refusal for an event that left the searchable statuses (AC4)", async () => {
    const refusal = `This event is confirmed, so it ${VENUE_EVENT_STATUS_PHRASE}.`;
    mockPlace.mockRejectedValueOnce(new Error(refusal));
    const user = userEvent.setup();
    render(<VenueHoldRequestsPage requests={[request]} />);
    await user.click(screen.getByRole("button", { name: "Place hold" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Date and time"), "2099-06-10T12:00");
    await user.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(refusal));
  });

  it("keeps a refusal for a request that stays in the queue in the form", async () => {
    mockDecline.mockRejectedValueOnce(new Error("Could not reach the server"));
    const user = userEvent.setup();
    render(<VenueHoldRequestsPage requests={[request]} />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.type(screen.getByLabelText("Reason for decline"), "Exams that week");
    await user.click(screen.getByRole("button", { name: "Confirm decline" }));
    expect(await screen.findByText("Could not reach the server")).toBeTruthy();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
