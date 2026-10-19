// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AvailabilityCheck } from "#/features/equipment-requests/components/equipment-review-blocks";
import { ReserveEquipmentDialog } from "#/features/equipment-requests/components/reserve-equipment-dialog";

const { checkEquipmentAvailability, checkLineAvailability, reserveEquipment } = vi.hoisted(() => ({
  checkEquipmentAvailability: vi.fn<() => Promise<unknown>>(),
  checkLineAvailability: vi.fn<() => Promise<unknown>>(),
  reserveEquipment: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("#/features/equipment-requests/server-fns", () => ({
  checkEquipmentAvailability,
  checkLineAvailability,
  reserveEquipment,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn<(message: string) => void>() } }));

const bookings = [
  { id: "morning", venueName: "Hall", startsAt: "2030-01-01T09:30", endsAt: "2030-01-01T12:45" },
  { id: "afternoon", venueName: "Hall", startsAt: "2030-01-01T14:30", endsAt: "2030-01-01T17:45" },
];

describe("equipment booking controls", () => {
  it("sends the selected booking to the line check and reservation", async () => {
    const user = userEvent.setup();
    checkLineAvailability.mockResolvedValue({ availableQuantity: 5, period: bookings[1] });
    reserveEquipment.mockResolvedValue({ quantity: 2, arrangementStatus: "reserved" });
    render(
      <ReserveEquipmentDialog
        equipmentRequest={{ id: "line", item: "Projector", quantity: 2 }}
        bookings={bookings}
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />
    );
    const confirm = screen.getByRole("button", { name: "Confirm reservation" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(checkLineAvailability).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Session venue booking" }));
    await user.click(await screen.findByRole("option", { name: /14:30/ }));
    await waitFor(() =>
      expect(checkLineAvailability).toHaveBeenCalledWith({
        data: { equipmentRequestId: "line", venueRequestId: "afternoon" },
      })
    );
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    await user.click(confirm);
    await waitFor(() =>
      expect(reserveEquipment).toHaveBeenCalledWith({
        data: { equipmentRequestId: "line", venueRequestId: "afternoon", quantity: 2 },
      })
    );
  });

  it("discards an availability response after its booking changes", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<unknown>();
    checkEquipmentAvailability.mockReturnValue(pending.promise);
    render(
      <AvailabilityCheck
        eventId={12}
        equipmentTypes={[{ id: 1, name: "Projector" }]}
        bookings={bookings}
      />
    );
    await user.click(screen.getByRole("combobox", { name: "Equipment type" }));
    await user.click(await screen.findByRole("option", { name: "Projector" }));
    await user.click(screen.getByRole("combobox", { name: "Session venue booking" }));
    await user.click(await screen.findByRole("option", { name: /09:30/ }));
    await user.click(screen.getByRole("button", { name: "Check availability" }));
    await waitFor(() =>
      expect(checkEquipmentAvailability).toHaveBeenCalledWith({
        data: {
          eventId: 12,
          equipmentTypeId: 1,
          requestedQuantity: undefined,
          venueRequestId: "morning",
        },
      })
    );
    const bookingSelect = screen.getByRole("combobox", { name: "Session venue booking" });
    await user.click(bookingSelect);
    await user.click(await screen.findByRole("option", { name: /14:30/ }));
    expect(bookingSelect.textContent).toContain("14:30");
    await act(async () =>
      pending.resolve({
        equipmentTypeName: "Projector",
        available: 5,
        shortfall: 0,
        requested: 0,
        period: bookings[0],
      })
    );
    expect(screen.queryByText(/Projector: 5 available/)).toBeNull();
  });

  it("discards a line-check response after its booking changes", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<unknown>();
    checkLineAvailability.mockReset();
    checkLineAvailability.mockReturnValueOnce(pending.promise);
    checkLineAvailability.mockResolvedValue({ availableQuantity: 5, period: bookings[1] });
    render(
      <ReserveEquipmentDialog
        equipmentRequest={{ id: "line", item: "Projector", quantity: 2 }}
        bookings={bookings}
        open
        onOpenChange={vi.fn<(open: boolean) => void>()}
      />
    );
    await user.click(screen.getByRole("combobox", { name: "Session venue booking" }));
    await user.click(await screen.findByRole("option", { name: /09:30/ }));
    await waitFor(() =>
      expect(checkLineAvailability).toHaveBeenCalledWith({
        data: { equipmentRequestId: "line", venueRequestId: "morning" },
      })
    );
    await user.click(screen.getByRole("combobox", { name: "Session venue booking" }));
    await user.click(await screen.findByRole("option", { name: /14:30/ }));
    await act(async () => pending.resolve({ availableQuantity: 5, period: bookings[0] }));
    const availability = screen.getByText("Availability:").parentElement as HTMLElement;
    await waitFor(() => expect(within(availability).queryByText(/14:30/)).not.toBeNull());
    expect(within(availability).queryByText(/09:30/)).toBeNull();
  });
});
