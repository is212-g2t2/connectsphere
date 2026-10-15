// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VenueRequestPanel } from "#/features/venue-requests/components/venue-request-panel";
import type {
  VenueRequestContext,
  VenueRequestContextRow,
} from "#/features/venue-requests/server-fns";

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
  canRequest: true,
  requests: [],
};

const eventRequirements = {
  expectedAttendance: 80,
  layout: "Theatre seating",
  accessibilityRequirements: "Step-free access",
  requiredFacilities: "Projector, PA system",
};

const ownPending = {
  id: "req-1",
  startsAt: "2026-10-12T14:30",
  endsAt: "2026-10-12T18:45",
  status: "pending",
  requirements: eventRequirements,
  canWithdraw: true,
} satisfies VenueRequestContextRow;

const approved = {
  id: "req-0",
  startsAt: "2026-10-12T09:00",
  endsAt: "2026-10-12T11:00",
  status: "approved",
  requirements: { ...eventRequirements, expectedAttendance: 30, layout: "Boardroom" },
  canWithdraw: false,
} satisfies VenueRequestContextRow;

function withRows(...requests: VenueRequestContextRow[]): VenueRequestContext {
  return { ...openContext, requests };
}

function renderPanel(context: VenueRequestContext) {
  return render(<VenueRequestPanel venueId={3} venueName="Harbour Hall" context={context} />);
}

function requestList() {
  return screen.getByRole("list", { name: "Requests for Annual Gala" });
}

describe("VenueRequestPanel (PTR-31, PTR-138 AC4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("the request form", () => {
    it("prefills the form from the event's proposed window", () => {
      renderPanel(openContext);

      expect(screen.getByRole("heading", { name: "Request this venue" })).toBeTruthy();
      expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2026-10-12");
      expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "14:30");
      expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "18:45");
    });

    it("prefers the adjusted window carried in from a rejection over the event's own (PTR-35 AC1)", () => {
      render(
        <VenueRequestPanel
          venueId={9}
          venueName="Harbour Hall"
          context={openContext}
          prefill={{ date: "2027-04-21", startTime: "10:00", endTime: "13:30" }}
        />
      );

      expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2027-04-21");
      expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "10:00");
      expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "13:30");
      expect(screen.getByText(/carried over from the search or the rejected request/)).toBeTruthy();
      // The reader lands on the prefilled form, not on the list above it.
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Request this venue" })
      );
    });

    it.each([
      { name: "end does not come after its start", startTime: "13:30", endTime: "10:00" },
      { name: "end equals its start", startTime: "13:30", endTime: "13:30" },
    ])("ignores a carried-in window whose $name (PTR-35)", ({ startTime, endTime }) => {
      render(
        <VenueRequestPanel
          venueId={9}
          venueName="Harbour Hall"
          context={openContext}
          prefill={{ date: "2027-04-21", startTime, endTime }}
        />
      );

      expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2026-10-12");
      expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "14:30");
      expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "18:45");
      expect(screen.queryByText(/carried over from the search or the rejected request/)).toBeNull();
    });

    it("starts the session requirements from the event's requirements (PTR-138 AC1)", () => {
      renderPanel(openContext);

      const group = screen.getByRole("group", { name: "Session requirements" });
      expect(within(group).getByLabelText("Expected attendance")).toHaveProperty("value", "80");
      expect(within(group).getByLabelText("Layout")).toHaveProperty("value", "Theatre seating");
      expect(within(group).getByLabelText("Accessibility")).toHaveProperty(
        "value",
        "Step-free access"
      );
      expect(within(group).getByLabelText("Facilities")).toHaveProperty(
        "value",
        "Projector, PA system"
      );
      expect(group.textContent).toContain("These start from the event's requirements");
    });

    it("prefers carried session values over the event's, one value at a time (PTR-138 AC1)", () => {
      render(
        <VenueRequestPanel
          venueId={3}
          venueName="Harbour Hall"
          context={openContext}
          prefill={{ expectedAttendance: 30, layout: "Boardroom", requiredFacilities: "" }}
        />
      );

      expect(screen.getByLabelText("Expected attendance")).toHaveProperty("value", "30");
      expect(screen.getByLabelText("Layout")).toHaveProperty("value", "Boardroom");
      expect(screen.getByLabelText("Accessibility")).toHaveProperty("value", "Step-free access");
      expect(screen.getByLabelText("Facilities")).toHaveProperty("value", "");
      // No window came with them, so the event's window stays and the form keeps its place.
      expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "14:30");
      expect(screen.queryByText(/carried over/)).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it("keeps a carried date without times, and leaves the times empty on another day", () => {
      render(
        <VenueRequestPanel
          venueId={3}
          venueName="Harbour Hall"
          context={openContext}
          prefill={{ date: "2026-10-14" }}
        />
      );

      expect(screen.getByLabelText("Date (required)")).toHaveProperty("value", "2026-10-14");
      expect(screen.getByLabelText("Start time (required)")).toHaveProperty("value", "");
      expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "");
    });

    it("sends the session values the Coordinator changed (PTR-138 AC1)", async () => {
      const user = userEvent.setup();
      requestVenue.mockResolvedValueOnce({ id: "req-1" });
      renderPanel(openContext);

      await user.clear(screen.getByLabelText("Expected attendance"));
      await user.type(screen.getByLabelText("Expected attendance"), "30");
      await user.clear(screen.getByLabelText("Facilities"));
      await user.click(screen.getByRole("button", { name: "Send booking request" }));

      await waitFor(() => {
        expect(requestVenue).toHaveBeenCalledWith({
          data: expect.objectContaining({
            expectedAttendance: 30,
            layout: "Theatre seating",
            accessibilityRequirements: "Step-free access",
            requiredFacilities: "",
          }),
        });
      });
    });

    it("leaves a blank attendance out, so the server uses the event's figure", async () => {
      const user = userEvent.setup();
      requestVenue.mockResolvedValueOnce({ id: "req-1" });
      renderPanel(openContext);

      await user.clear(screen.getByLabelText("Expected attendance"));
      await user.click(screen.getByRole("button", { name: "Send booking request" }));

      await waitFor(() => {
        expect(requestVenue).toHaveBeenCalled();
      });
      expect(requestVenue.mock.calls[0][0].data).not.toHaveProperty("expectedAttendance");
    });

    it("refuses a layout that names no supported layout before calling the server", async () => {
      const user = userEvent.setup();
      renderPanel(openContext);

      await user.clear(screen.getByLabelText("Layout"));
      await user.type(screen.getByLabelText("Layout"), "Round tables");
      await user.click(screen.getByRole("button", { name: "Send booking request" }));

      const layoutInput = screen.getByLabelText("Layout");
      expect(layoutInput.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(layoutInput);
      expect(screen.getByRole("alert").textContent).toBe(
        "Choose only from the supported room layouts"
      );
      expect(requestVenue).not.toHaveBeenCalled();
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

      // A request covers one calendar day. Do not silently use only the first day of a multi-day
      // event.
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
            expectedAttendance: 80,
            layout: "Theatre seating",
            accessibilityRequirements: "Step-free access",
            requiredFacilities: "Projector, PA system",
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
      // `data-invalid` styles the label. Checking only `aria-invalid` would miss a styling regression.
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
        // Render the refusal in the form's `FieldError` slot.
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toBe("Forbidden");
        expect(alert.getAttribute("data-slot")).toBe("field-error");
      });
    });
  });

  describe("the list of requests at this venue", () => {
    it("says the event has no request here yet and offers the form", () => {
      renderPanel(openContext);

      expect(screen.getByRole("heading", { name: "Requests for Annual Gala" })).toBeTruthy();
      expect(
        screen.getByText("This event has no pending request or booking at Harbour Hall yet.")
      ).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Requests for Annual Gala" })).toBeNull();
      expect(screen.getByRole("button", { name: "Send booking request" })).toBeTruthy();
    });

    it("lists one pending request and keeps the form open for another time", () => {
      renderPanel(withRows(ownPending));

      const rows = within(requestList()).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("12 Oct 2026, 14:30 – 18:45");
      expect(within(rows[0]).getByText("Pending")).toBeTruthy();
      expect(
        within(rows[0]).getByRole("button", {
          name: "Withdraw request for 12 Oct 2026, 14:30 – 18:45",
        })
      ).toBeTruthy();

      // The form stays below the list, so the Coordinator can book another session here.
      expect(screen.getByRole("heading", { name: "Request another time" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Request this venue" })).toBeNull();
      expect(screen.getByRole("button", { name: "Send booking request" })).toBeTruthy();
    });

    it("lists an approved booking and a pending request in the order given, each with its own state", () => {
      renderPanel(withRows(approved, ownPending));

      const rows = within(requestList()).getAllByRole("listitem");
      expect(rows.map(row => row.textContent)).toEqual([
        expect.stringContaining("12 Oct 2026, 09:00 – 11:00"),
        expect.stringContaining("12 Oct 2026, 14:30 – 18:45"),
      ]);
      // An approved booking shows as booked. Only Venue Staff change it, so it has no action.
      expect(within(rows[0]).getByText("Approved")).toBeTruthy();
      expect(within(rows[0]).getByText("Booked. Venue Staff release or amend it.")).toBeTruthy();
      expect(within(rows[0]).queryByRole("button")).toBeNull();
      expect(within(rows[1]).getByText("Pending")).toBeTruthy();
      expect(within(rows[1]).getByRole("button", { name: /^Withdraw request/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Send booking request" })).toBeTruthy();
    });

    it("names each row's attendance and layout, so two sessions stay apart (PTR-138 AC1)", () => {
      renderPanel(withRows(approved, ownPending));

      const rows = within(requestList()).getAllByRole("listitem");
      expect(within(rows[0]).getByText("30 attendees, Boardroom")).toBeTruthy();
      expect(within(rows[1]).getByText("80 attendees, Theatre")).toBeTruthy();
    });

    it("does not offer withdrawal of a request that another Coordinator raised", () => {
      renderPanel(withRows({ ...ownPending, canWithdraw: false }, { ...ownPending, id: "req-2" }));

      const rows = within(requestList()).getAllByRole("listitem");
      expect(within(rows[0]).queryByRole("button")).toBeNull();
      expect(
        within(rows[0]).getByText("Raised by another Coordinator, so only they can withdraw it.")
      ).toBeTruthy();
      expect(within(rows[1]).getByRole("button", { name: /^Withdraw request/ })).toBeTruthy();
    });

    it("shows a raiser who can no longer request their own rows, without the form", () => {
      renderPanel({ ...withRows(ownPending), canRequest: false });

      expect(within(requestList()).getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText(/you cannot raise a new one for this event/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Send booking request" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Request another time" })).toBeNull();
    });
  });

  describe("withdrawing a request", () => {
    it("withdraws only after the confirmation that names the window", async () => {
      const user = userEvent.setup();
      withdrawVenueRequest.mockResolvedValueOnce({ id: "req-1" });
      renderPanel(withRows(approved, ownPending));

      await user.click(screen.getByRole("button", { name: /^Withdraw request/ }));
      // Do not withdraw the request until the user confirms in the dialog.
      expect(withdrawVenueRequest).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain("Harbour Hall on 12 Oct 2026, 14:30 – 18:45");

      await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(withdrawVenueRequest).toHaveBeenCalledWith({ data: { id: "req-1" } });
        expect(success).toHaveBeenCalledWith("Venue request withdrawn.");
        expect(invalidate).toHaveBeenCalled();
      });
    });

    it("cancels the withdrawal without calling the server", async () => {
      const user = userEvent.setup();
      renderPanel(withRows(ownPending));

      await user.click(screen.getByRole("button", { name: /^Withdraw request/ }));
      await screen.findByRole("alertdialog");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(withdrawVenueRequest).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
      });
      expect(screen.getByRole("button", { name: /^Withdraw request/ })).toBeTruthy();
    });

    it("shows a refused withdrawal inside the open dialog, leaving Confirm usable", async () => {
      const user = userEvent.setup();
      withdrawVenueRequest.mockRejectedValueOnce(new Error("Forbidden"));
      renderPanel(withRows(ownPending));

      await user.click(screen.getByRole("button", { name: /^Withdraw request/ }));
      await user.click(await screen.findByRole("button", { name: "Confirm" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Forbidden");
      // Confirm is a plain button. Keep the dialog open on failure, show the message inside it, and
      // enable Confirm again.
      expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
      expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", false);
    });
  });

  describe("focus", () => {
    it("moves focus to the list heading when a sent request adds a row", () => {
      const { rerender } = renderPanel(withRows(approved));
      expect(document.activeElement).toBe(document.body);

      rerender(
        <VenueRequestPanel
          venueId={3}
          venueName="Harbour Hall"
          context={withRows(approved, ownPending)}
        />
      );

      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Requests for Annual Gala" })
      );
    });

    it("moves focus to the list heading when a withdrawal removes the row", async () => {
      const user = userEvent.setup();
      withdrawVenueRequest.mockResolvedValueOnce({ id: "req-1" });
      const { rerender } = renderPanel(withRows(ownPending));

      await user.click(screen.getByRole("button", { name: /^Withdraw request/ }));
      await user.click(await screen.findByRole("button", { name: "Confirm" }));
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalled();
      });

      // The loader reruns without the withdrawn row.
      rerender(<VenueRequestPanel venueId={3} venueName="Harbour Hall" context={openContext} />);

      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole("heading", { name: "Requests for Annual Gala" })
        );
      });
    });

    it("leaves focus and typed times alone when the loader reruns with the same rows", async () => {
      const user = userEvent.setup();
      const { rerender } = renderPanel(withRows(ownPending));

      const endInput = screen.getByLabelText("End time (required)");
      await user.clear(endInput);
      await user.type(endInput, "21:00");

      // A loader rerun builds a new context object with the same values.
      rerender(
        <VenueRequestPanel
          venueId={3}
          venueName="Harbour Hall"
          context={{ ...withRows({ ...ownPending }), event: { ...openContext.event } }}
        />
      );

      expect(screen.getByLabelText("End time (required)")).toHaveProperty("value", "21:00");
      expect(document.activeElement).toBe(screen.getByLabelText("End time (required)"));
    });
  });
});
