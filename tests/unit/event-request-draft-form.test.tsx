import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EventRequestDraftForm } from "#/features/event-requests/components/draft-form";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}

describe("EventRequestDraftForm", () => {
  it("saves a partial draft and omits the fields left blank", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(<EventRequestDraftForm onSave={onSave} />);

    fill("Event name", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        eventName: "Community workshop",
        purpose: "",
      });
    });
  });

  it("submits the full set of draft fields", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(<EventRequestDraftForm onSave={onSave} />);

    fill("Event name", "Workshop");
    fill("Purpose", "Plan");
    fill("Proposed start", "2030-11-18T09:30");
    fill("Proposed end", "2030-11-18T12:45");
    fill("Expected attendance", "25");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        eventName: "Workshop",
        purpose: "Plan",
        proposedStart: "2030-11-18T09:30",
        proposedEnd: "2030-11-18T12:45",
        expectedAttendance: 25,
      });
    });
  });

  it("refuses an end that is not later than the start before saving", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(<EventRequestDraftForm onSave={onSave} />);

    fill("Proposed start", "2030-11-18T09:30");
    fill("Proposed end", "2030-11-18T09:29");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByRole("alert").textContent).toContain("later than the start");
    expect(
      screen.getByLabelText("Proposed end", { exact: true }).getAttribute("aria-invalid")
    ).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5"])("refuses an expected attendance of %s", async value => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(<EventRequestDraftForm onSave={onSave} />);

    fill("Expected attendance", value);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("positive whole number");
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the server refusal instead of a saved draft", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockRejectedValue(new Error("Forbidden"));
    render(<EventRequestDraftForm onSave={onSave} />);

    fill("Event name", "Workshop");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Forbidden");
    });
  });
});
