import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterAction } from "#/features/events/components/register-action";
import {
  ALREADY_REGISTERED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  venueCapacityReachedMessage,
} from "#/features/events/registration";

const { registerForEvent, invalidate, success } = vi.hoisted(() => ({
  registerForEvent: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({ registerForEvent }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

async function register() {
  const user = userEvent.setup();
  render(<RegisterAction eventId={12} eventName="Open Day" />);
  await user.click(screen.getByRole("button", { name: "Register" }));
}

describe("RegisterAction (PTR-45)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("registers the Attendee, tells them and reloads the event", async () => {
    registerForEvent.mockResolvedValue({ status: "registered" });

    await register();

    await waitFor(() => expect(registerForEvent).toHaveBeenCalledWith({ data: { id: 12 } }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("You are registered for Open Day."));
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    REGISTRATION_NOT_OPEN_MESSAGE,
    ALREADY_REGISTERED_MESSAGE,
    "This event is full.",
    venueCapacityReachedMessage(60),
  ])("shows the refusal %o as the server words it", async message => {
    registerForEvent.mockRejectedValue(new Error(message));

    await register();

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(success).not.toHaveBeenCalled();
    // The places or the period may have moved since the page loaded.
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to generic text for a failure that is not a named refusal", async () => {
    registerForEvent.mockRejectedValue(new Error("Forbidden"));

    await register();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not register for this event. Try again."
    );
  });
});
