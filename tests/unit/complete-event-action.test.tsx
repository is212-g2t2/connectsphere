import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompleteEventAction } from "#/features/events/components/complete-event-action";
import {
  COMPLETION_REFUSAL_HEADING,
  EVENT_HAS_NOT_ENDED_MESSAGE,
} from "#/features/events/completion";

const { completeEvent, invalidate, success } = vi.hoisted(() => ({
  completeEvent: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({ completeEvent }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success } }));

async function openAndComplete() {
  const user = userEvent.setup();
  render(<CompleteEventAction eventId={7} eventName="Demo Day" />);
  await user.click(screen.getByRole("button", { name: "Complete event: Demo Day" }));
  await user.click(await screen.findByRole("button", { name: "Mark completed" }));
}

describe("CompleteEventAction (PTR-25)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("completes the event, tells the Coordinator and reloads", async () => {
    completeEvent.mockResolvedValue({});

    await openAndComplete();

    await waitFor(() => expect(completeEvent).toHaveBeenCalledWith({ data: { id: 7 } }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Event marked as completed."));
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows the server's timing refusal", async () => {
    completeEvent.mockRejectedValue(
      new Error(`${COMPLETION_REFUSAL_HEADING}\n- ${EVENT_HAS_NOT_ENDED_MESSAGE}`)
    );

    await openAndComplete();

    const [alert] = await screen.findAllByRole("alert", { hidden: true });
    expect(alert.textContent).toContain(EVENT_HAS_NOT_ENDED_MESSAGE);
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("uses generic text for an unnamed failure", async () => {
    completeEvent.mockRejectedValue(new Error("Forbidden"));

    await openAndComplete();

    const [alert] = await screen.findAllByRole("alert", { hidden: true });
    expect(alert.textContent).toContain("Could not complete this event. Try again.");
  });

  it("disables the action and explains why the event is not eligible", () => {
    render(
      <CompleteEventAction
        eventId={7}
        eventName="Demo Day"
        disabledReason={EVENT_HAS_NOT_ENDED_MESSAGE}
      />
    );

    expect(screen.getByRole("button", { name: "Complete event: Demo Day" })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByText(EVENT_HAS_NOT_ENDED_MESSAGE)).toBeTruthy();
  });
});
