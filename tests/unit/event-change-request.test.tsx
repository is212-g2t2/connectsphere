import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventChangeRequestForm } from "#/features/event-requests/components/event-change-request-form";
import {
  CHANGE_REQUEST_TEXT_MAX,
  parseEventChangeRequestInput,
} from "#/features/event-requests/schema";

const { invalidate, raiseEventChangeRequest, success } = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  raiseEventChangeRequest:
    vi.fn<
      (input: {
        data: { id: number; whatShouldChange: string; requestedValue: string };
      }) => Promise<unknown>
    >(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

vi.mock("#/features/event-requests/server-fns", () => ({ raiseEventChangeRequest }));
vi.mock("sonner", () => ({ toast: { success } }));

describe("event change request input (PTR-51 AC2)", () => {
  it("trims and accepts both required statements", () => {
    expect(
      parseEventChangeRequestInput({
        id: 7,
        whatShouldChange: "  Proposed date  ",
        requestedValue: "  18 November at 10:00  ",
      })
    ).toEqual({
      id: 7,
      whatShouldChange: "Proposed date",
      requestedValue: "18 November at 10:00",
    });
  });

  it.each([
    [{ id: 7, whatShouldChange: "", requestedValue: "New value" }, "State what should change"],
    [{ id: 7, whatShouldChange: "Date", requestedValue: "" }, "Enter the requested new value"],
    [
      { id: 7, whatShouldChange: "x".repeat(CHANGE_REQUEST_TEXT_MAX + 1), requestedValue: "New" },
      `What should change must be ${CHANGE_REQUEST_TEXT_MAX} characters or fewer`,
    ],
  ])("refuses an incomplete or oversized request", (input, message) => {
    expect(() => parseEventChangeRequestInput(input)).toThrow(message);
  });
});

describe("EventChangeRequestForm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    raiseEventChangeRequest.mockResolvedValue({ id: 9 });
    invalidate.mockResolvedValue();
  });

  it("submits what should change and its requested new value, then refreshes the history", async () => {
    const user = userEvent.setup();
    render(<EventChangeRequestForm requestId={7} />);

    await user.type(screen.getByLabelText("What should change"), "Proposed date");
    await user.type(screen.getByLabelText("Requested new value"), "18 November at 10:00");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    await waitFor(() =>
      expect(raiseEventChangeRequest).toHaveBeenCalledExactlyOnceWith({
        data: {
          id: 7,
          whatShouldChange: "Proposed date",
          requestedValue: "18 November at 10:00",
        },
      })
    );
    expect(success).toHaveBeenCalledWith("Change request recorded.");
    expect(invalidate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText<HTMLTextAreaElement>("What should change").value).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Requested new value").value).toBe("");
  });

  it("keeps the form values and shows the server refusal", async () => {
    raiseEventChangeRequest.mockRejectedValue(new Error("This event can no longer be changed."));
    const user = userEvent.setup();
    render(<EventChangeRequestForm requestId={7} />);

    await user.type(screen.getByLabelText("What should change"), "Venue");
    await user.type(screen.getByLabelText("Requested new value"), "Harbour Hall");
    await user.click(screen.getByRole("button", { name: "Request change" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This event can no longer be changed."
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("What should change").value).toBe("Venue");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Requested new value").value).toBe(
      "Harbour Hall"
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});
