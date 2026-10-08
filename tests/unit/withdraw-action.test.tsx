import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WithdrawAction } from "#/features/events/components/withdraw-action";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import {
  NOT_REGISTERED_MESSAGE,
  PLACE_FREED_AT_CAPACITY_MESSAGE,
  PLACE_FREED_MESSAGE,
} from "#/features/events/withdrawal";

const { withdrawFromEvent, invalidate, success } = vi.hoisted(() => ({
  withdrawFromEvent: vi.fn<(input: { data: { id: number } }) => Promise<boolean>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({ withdrawFromEvent }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

async function openModal() {
  const user = userEvent.setup();
  render(<WithdrawAction eventId={12} eventName="Open Day" />);
  await user.click(screen.getByRole("button", { name: "Withdraw registration" }));
  return user;
}

describe("WithdrawAction (PTR-47)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("renders trigger button", () => {
    render(<WithdrawAction eventId={12} eventName="Open Day" />);
    expect(screen.getByRole("button", { name: "Withdraw registration" })).toBeTruthy();
  });

  it("opens confirmation dialog when clicked (AC1)", async () => {
    await openModal();

    expect(screen.getByRole("heading", { name: "Withdraw registration" })).toBeTruthy();
    expect(
      screen.getByText("Are you sure you want to withdraw from Open Day? Your place will be freed.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy();
  });

  it("cancels withdrawal when Cancel is clicked and registration stands (AC1)", async () => {
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(withdrawFromEvent).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Withdraw registration" })).toBeNull();
  });

  it("withdraws the Attendee when confirmed, notifies with toast and reloads (AC1)", async () => {
    withdrawFromEvent.mockResolvedValue(false);
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(withdrawFromEvent).toHaveBeenCalledWith({ data: { id: 12 } }));
    await waitFor(() => expect(success).toHaveBeenCalledWith(PLACE_FREED_MESSAGE));
    expect(invalidate).toHaveBeenCalled();
  });

  it("tells the Attendee when the withdrawal frees a place at capacity", async () => {
    withdrawFromEvent.mockResolvedValue(true);
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() => expect(success).toHaveBeenCalledWith(PLACE_FREED_AT_CAPACITY_MESSAGE));
  });

  it("shows named refusal when not registered", async () => {
    withdrawFromEvent.mockRejectedValue(new Error(NOT_REGISTERED_MESSAGE));
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REGISTERED_MESSAGE);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("keeps the server's named refusal for a cancelled event", async () => {
    withdrawFromEvent.mockRejectedValue(new Error(CANCELLED_EVENT_ACTIVITY_MESSAGE));
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect((await screen.findByRole("alert")).textContent).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    expect(success).not.toHaveBeenCalled();
  });

  it("falls back to generic text for an unexpected error", async () => {
    withdrawFromEvent.mockRejectedValue(new Error("Network failure"));
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not withdraw from this event. Try again."
    );
    expect(success).not.toHaveBeenCalled();
  });
});
