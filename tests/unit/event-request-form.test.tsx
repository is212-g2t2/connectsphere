import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EventRequestForm } from "#/features/event-requests/components/request-form";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";

const BLANK_DRAFT = {
  eventName: "",
  purpose: "",
  proposedDates: [],
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
};

const initialValues: EventRequestDraftValues = {
  eventName: "  Community workshop  ",
  purpose: "  Meet volunteers\nPlan our next project.  ",
  expectedAttendance: 125,
  proposedDates: [
    { start: "2030-11-18T09:30", end: "2030-11-18T12:45" },
    { start: "2030-11-20T14:15", end: "2030-11-20T17:30" },
  ],
  description: "  Practical activities\nBring ideas & questions!  ",
  eventType: "  Workshop / community meet-up  ",
  venueRequirements: "  Ground floor\nNear public transport.  ",
  roomLayoutPreference: "  Tables of 6  ",
  accessibilityRequirements: "  Step-free access\nHearing loop.  ",
  specialArrangements: "  Early access at 08:45\nQuiet room available.  ",
  equipmentRequirements: [
    { type: "  Wireless microphones  ", quantity: 2 },
    { type: "HDMI projector & screen", quantity: 1 },
  ],
};

function makeOnSave() {
  return vi.fn<(values: EventRequestDraftValues) => Promise<void>>().mockResolvedValue(undefined);
}

function inputValue(label: string) {
  return screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(label, { exact: true })
    .value;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}

describe("EventRequestForm", () => {
  it("saves a partial draft and drops the blank rows", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name (required)", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        ...BLANK_DRAFT,
        eventName: "Community workshop",
      });
    });
  });

  it("drops an equipment line left entirely blank", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name (required)", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        ...BLANK_DRAFT,
        eventName: "Community workshop",
      });
    });
  });

  it("loads every captured value exactly and submits it untouched", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    const displayedValues = {
      "Event name (required)": initialValues.eventName,
      "Purpose (required)": initialValues.purpose,
      "Expected attendance (required)": "125",
      "Description (optional)": initialValues.description,
      "Type of event (optional)": initialValues.eventType,
      "Venue requirements (optional)": initialValues.venueRequirements,
      "Room-layout preference (optional)": initialValues.roomLayoutPreference,
      "Accessibility requirements (optional)": initialValues.accessibilityRequirements,
      "Special arrangements (optional)": initialValues.specialArrangements,
      "Proposed start 1 (required)": "2030-11-18T09:30",
      "Proposed end 1 (required)": "2030-11-18T12:45",
      "Proposed start 2 (required)": "2030-11-20T14:15",
      "Proposed end 2 (required)": "2030-11-20T17:30",
      "Equipment type 1": "  Wireless microphones  ",
      "Quantity 1": "2",
      "Equipment type 2": "HDMI projector & screen",
      "Quantity 2": "1",
    };
    for (const [label, value] of Object.entries(displayedValues)) {
      expect(inputValue(label)).toBe(value);
    }

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(initialValues);
  });

  it("submits added proposed dates and equipment lines", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name (required)", "Workshop");
    await user.click(screen.getByRole("button", { name: "Add proposed date" }));
    fill("Proposed start 1 (required)", "2030-11-18T09:30");
    fill("Proposed end 1 (required)", "2030-11-18T11:00");
    fill("Proposed start 2 (required)", "2030-11-19T13:00");
    fill("Proposed end 2 (required)", "2030-11-19T15:30");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 1", "Projector");
    fill("Quantity 1", "1");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 2", "Microphone");
    fill("Quantity 2", "2");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        ...BLANK_DRAFT,
        eventName: "Workshop",
        proposedDates: [
          { start: "2030-11-18T09:30", end: "2030-11-18T11:00" },
          { start: "2030-11-19T13:00", end: "2030-11-19T15:30" },
        ],
        equipmentRequirements: [
          { type: "Projector", quantity: 1 },
          { type: "Microphone", quantity: 2 },
        ],
      });
    });
  });

  it.each([
    ["Proposed end 1 (required)", "2030-11-18T09:30", "later than the start"],
    ["Proposed end 1 (required)", "2030-11-18T09:29", "later than the start"],
    ["Proposed end 2 (required)", "2030-11-20T14:15", "later than the start"],
    ["Expected attendance (required)", "0", "positive whole number"],
    ["Expected attendance (required)", "-1", "positive whole number"],
    ["Expected attendance (required)", "1.5", "positive whole number"],
    ["Expected attendance (required)", "1.0000000000000001", "positive whole number"],
    ["Quantity 1", "0", "positive whole number"],
    ["Quantity 1", "1.0000000000000001", "positive whole number"],
  ])("refuses to save when %s is %s", async (label, value, error) => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    fill(label, value);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByLabelText(label, { exact: true }).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(error);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reopens and re-saves half-typed equipment lines without inventing values", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    const equipmentRequirements = [{ type: "Projector" }, { type: "", quantity: 2 }];
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, equipmentRequirements }}
        onSave={onSave}
      />
    );

    expect(inputValue("Equipment type 1")).toBe("Projector");
    expect(inputValue("Quantity 1")).toBe("");
    expect(inputValue("Quantity 2")).toBe("2");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...initialValues, equipmentRequirements });
  });

  it("keeps the remaining equipment values when a line is removed and another is added", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, equipmentRequirements: [] }}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 1", "Projector");
    fill("Quantity 1", "1");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 2", "  Wireless microphones  ");
    fill("Quantity 2", "2");
    await user.click(screen.getByRole("button", { name: "Remove equipment 1" }));

    expect(inputValue("Equipment type 1")).toBe("  Wireless microphones  ");
    expect(inputValue("Quantity 1")).toBe("2");
    expect(screen.queryByLabelText("Equipment type 2")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    expect(inputValue("Equipment type 2")).toBe("");
    expect(inputValue("Quantity 2")).toBe("");
    fill("Equipment type 2", "Speakers");
    fill("Quantity 2", "3");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...initialValues,
      equipmentRequirements: [
        { type: "  Wireless microphones  ", quantity: 2 },
        { type: "Speakers", quantity: 3 },
      ],
    });
  });

  it("displays a save failure and retains the entered requirements for another attempt", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<(values: EventRequestDraftValues) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Could not save this draft. Try again."))
      .mockResolvedValue(undefined);
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    const description = "  Updated workshop notes\nKeep these even when saving fails.  ";
    fill("Description (optional)", description);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Could not save this draft. Try again.");
    });
    expect(inputValue("Description (optional)")).toBe(description);
    expect(inputValue("Event name (required)")).toBe(initialValues.eventName);
    expect(inputValue("Proposed start 2 (required)")).toBe("2030-11-20T14:15");
    expect(inputValue("Equipment type 1")).toBe("  Wireless microphones  ");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ ...initialValues, description });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
