import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WithdrawAction } from "#/features/events/components/withdraw-action";
import { NOT_REGISTERED_MESSAGE } from "#/features/events/withdrawal";

const { withdrawFromEvent, invalidate, success } = vi.hoisted(() => ({
  withdrawFromEvent: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
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
      screen.getByText(
        "Are you sure you want to withdraw from Open Day? Your place will be freed and given to someone else."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm withdrawal" })).toBeTruthy();
  });

  it("cancels withdrawal when Cancel is clicked and registration stands (AC1)", async () => {
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(withdrawFromEvent).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Withdraw registration" })).toBeNull();
  });

  it("withdraws the Attendee when confirmed, notifies with toast and reloads (AC1)", async () => {
    withdrawFromEvent.mockResolvedValue(undefined);
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    await waitFor(() => expect(withdrawFromEvent).toHaveBeenCalledWith({ data: { id: 12 } }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("You have withdrawn from Open Day."));
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows named refusal when not registered", async () => {
    withdrawFromEvent.mockRejectedValue(new Error(NOT_REGISTERED_MESSAGE));
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REGISTERED_MESSAGE);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to generic text for an unexpected error", async () => {
    withdrawFromEvent.mockRejectedValue(new Error("Network failure"));
    const user = await openModal();

    await user.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not withdraw from this event. Try again."
    );
    expect(success).not.toHaveBeenCalled();
  });
});
