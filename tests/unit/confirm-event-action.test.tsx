import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmEventAction } from "#/features/events/components/confirm-event-action";
import { confirmationRefusalMessage } from "#/features/events/confirmation";

const { confirmEvent, invalidate, success } = vi.hoisted(() => ({
  confirmEvent: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({ confirmEvent }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

async function openAndConfirm() {
  const user = userEvent.setup();
  render(<ConfirmEventAction eventId={7} eventName="Demo Day" />);
  await user.click(screen.getByRole("button", { name: "Confirm Demo Day" }));
  await user.click(await screen.findByRole("button", { name: "Confirm" }));
}

describe("ConfirmEventAction (PTR-24)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("confirms the event, tells the Coordinator and reloads", async () => {
    confirmEvent.mockResolvedValue({});

    await openAndConfirm();

    await waitFor(() => expect(confirmEvent).toHaveBeenCalledWith({ data: { id: 7 } }));
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringContaining("confirmed")));
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows every outstanding arrangement the server names", async () => {
    confirmEvent.mockRejectedValue(
      new Error(
        confirmationRefusalMessage([
          "There is no approved venue booking.",
          "Projector is not arranged (requested).",
        ])
      )
    );

    await openAndConfirm();

    const [alert] = await screen.findAllByRole("alert", { hidden: true });
    expect(alert.textContent).toContain("There is no approved venue booking.");
    expect(alert.textContent).toContain("Projector is not arranged (requested).");
    expect(success).not.toHaveBeenCalled();
    // The named items may have moved since the page loaded.
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to generic text for a failure that is not a named refusal", async () => {
    confirmEvent.mockRejectedValue(new Error("Forbidden"));

    await openAndConfirm();

    const [alert] = await screen.findAllByRole("alert", { hidden: true });
    expect(alert.textContent).toContain("Could not confirm this event. Try again.");
  });
});
