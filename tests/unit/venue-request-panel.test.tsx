import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VenueRequestPanel } from "#/features/venue-requests/components/venue-request-panel";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";

const { requestVenue, withdrawVenueRequest, invalidate, success } = vi.hoisted(() => ({
  requestVenue: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  withdrawVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/venue-requests/server-fns", () => ({
  requestVenue,
  withdrawVenueRequest,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: vi.fn<() => void>(), invalidate }),
}));

vi.mock("sonner", () => ({ toast: { success } }));

const openContext: VenueRequestContext = {
  event: {
    id: 12,
    name: "Annual Gala",
    eventDate: "2026-10-12",
    endDate: "2026-10-12",
    startTime: "14:30",
    endTime: "18:45",
    expectedAttendance: 80,
    layout: "Theatre seating",
    accessibilityRequirements: "Step-free access",
    requiredFacilities: "Projector, PA system",
  },
  request: null,
};

const pendingContext: VenueRequestContext = {
  ...openContext,
  request: {
    id: "req-1",
    startsAt: "2026-10-12T14:30",
    endsAt: "2026-10-12T18:45",
    canWithdraw: true,
  },
};

function renderPanel(context: VenueRequestContext) {
  return render(<VenueRequestPanel venueId={3} venueName="Harbour Hall" context={context} />);
}

describe("VenueRequestPanel (PTR-31)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prefills the form from the event's proposed window", () => {
    renderPanel(openContext);

    expect(screen.getByRole("heading", { name: "Request this venue" })).toBeTruthy();
    expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2026-10-12");
    expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "14:30");
    expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "18:45");
  });

  it("labels each requirement as its own fact before the request is sent", () => {
    renderPanel(openContext);

    const list = screen.getByText("Expected attendance").closest("dl");
    expect(list).not.toBeNull();
    const terms = [...(list?.querySelectorAll("dt") ?? [])].map(node => node.textContent);
    const values = [...(list?.querySelectorAll("dd") ?? [])].map(node => node.textContent);

    expect(terms).toEqual(["Expected attendance", "Layout", "Accessibility", "Facilities"]);
    expect(values).toEqual(["80", "Theatre", "Step-free access", "Projector, PA system"]);
  });

  it("leaves the times empty and explains why when the event window spans more than one day", () => {
    renderPanel({
      ...openContext,
      event: {
        ...openContext.event,
        eventDate: "2026-10-12",
        endDate: "2026-10-13",
        startTime: "14:30",
        endTime: "18:45",
      },
    });

    // A request covers one civil day, so a multi-day event must not truncate silently to its
    // first day's hours.
    expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2026-10-12");
    expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "");
    expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "");
    expect(
      screen.getByText(
        "This event spans more than one day, so choose the date and times this request covers."
      )
    ).toBeTruthy();
  });

  it("sends the request for the event and venue, then reloads the panel", async () => {
    const user = userEvent.setup();
    requestVenue.mockResolvedValueOnce({ id: "req-1" });
    renderPanel(openContext);

    await user.clear(screen.getByLabelText("End time (required)"));
    await user.type(screen.getByLabelText("End time (required)"), "20:00");
    await user.click(screen.getByRole("button", { name: "Send booking request" }));

    await waitFor(() => {
      expect(requestVenue).toHaveBeenCalledWith({
        data: {
          eventId: 12,
          venueId: 3,
          date: "2026-10-12",
          startTime: "14:30",
          endTime: "20:00",
        },
      });
    });
    await waitFor(() => {
      expect(success).toHaveBeenCalledWith("Venue request sent.");
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("refuses an incomplete window before calling the server", async () => {
    const user = userEvent.setup();
    renderPanel(openContext);

    await user.clear(screen.getByLabelText("End time (required)"));
    await user.click(screen.getByRole("button", { name: "Send booking request" }));

    expect(screen.getByText("Enter start and end times as HH:MM")).toBeTruthy();
    expect(requestVenue).not.toHaveBeenCalled();
  });

  it("binds the end-time error to the end-time field and focuses that input", async () => {
    const user = userEvent.setup();
    renderPanel(openContext);

    await user.clear(screen.getByLabelText("End time (required)"));
    await user.click(screen.getByRole("button", { name: "Send booking request" }));

    const endInput = screen.getByLabelText("End time (required)");
    expect(endInput.getAttribute("aria-invalid")).toBe("true");
    // The wrapper carries `data-invalid`, which is what tints the label; `aria-invalid` alone
    // would let that regress unnoticed.
    expect(endInput.closest("[data-slot='field']")?.getAttribute("data-invalid")).toBe("true");
    expect(document.activeElement).toBe(endInput);
    expect(screen.getByRole("alert").textContent).toContain("Enter start and end times as HH:MM");
  });

  it("shows the refusal a refused request comes back with", async () => {
    const user = userEvent.setup();
    requestVenue.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel(openContext);

    await user.click(screen.getByRole("button", { name: "Send booking request" }));

    await waitFor(() => {
      // The refusal lands in the form's own error slot, rendered as a `FieldError`.
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Forbidden");
      expect(alert.getAttribute("data-slot")).toBe("field-error");
    });
  });

  it("withdraws only after the confirmation is confirmed", async () => {
    const user = userEvent.setup();
    withdrawVenueRequest.mockResolvedValueOnce({ id: "req-1" });
    renderPanel(pendingContext);

    expect(screen.getByRole("heading", { name: "Venue request" })).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText(/12 Oct 2026, 14:30 – 18:45/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send booking request" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Withdraw request" }));
    // Opening the dialog is the gate: nothing is withdrawn until Confirm runs.
    expect(withdrawVenueRequest).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(withdrawVenueRequest).toHaveBeenCalledWith({ data: { id: "req-1" } });
      expect(success).toHaveBeenCalledWith("Venue request withdrawn.");
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("cancels the withdrawal without calling the server", async () => {
    const user = userEvent.setup();
    renderPanel(pendingContext);

    await user.click(screen.getByRole("button", { name: "Withdraw request" }));
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(withdrawVenueRequest).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeTruthy();
  });

  it("shows a refused withdrawal inside the open dialog, leaving Confirm usable", async () => {
    const user = userEvent.setup();
    withdrawVenueRequest.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel(pendingContext);

    await user.click(screen.getByRole("button", { name: "Withdraw request" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Forbidden");
    // Confirm is a plain Button, so only success unmounts the dialog. A failure keeps it open,
    // which means the message must render inside it and Confirm must be interactive again.
    expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", false);
  });

  it("does not offer withdrawal to a Coordinator who did not raise the request", () => {
    renderPanel({
      ...pendingContext,
      request: {
        id: "req-1",
        startsAt: "2026-10-12T14:30",
        endsAt: "2026-10-12T18:45",
        canWithdraw: false,
      },
    });

    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
    expect(
      screen.getByText("Raised by another Coordinator, so only they can withdraw it.")
    ).toBeTruthy();
  });
});
