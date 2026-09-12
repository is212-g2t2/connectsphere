import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NOT_PERMITTED_MESSAGE } from "#/features/auth/session";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import {
  CAPACITY_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  DUPLICATE_NAME_MESSAGE,
} from "#/features/venues/schema";
import type { VenueValues } from "#/features/venues/schema";

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}

function valueOf(label: string): string {
  const element = screen.getByLabelText(label, { exact: true });
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${label} is not an input`);
  }
  return element.value;
}

function isChecked(name: string): boolean {
  return screen.getByRole("checkbox", { name }).getAttribute("aria-checked") === "true";
}

function saveSpy() {
  return vi.fn<(values: VenueValues) => Promise<void>>().mockResolvedValue(undefined);
}

const harbourHall: Omit<VenueValues, "id"> = {
  name: "Harbour Hall",
  location: "Level 1, Marina Centre",
  maxCapacity: 300,
  facilities: ["Stage", "Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre", "banquet"],
  operatingHours: { ...DEFAULT_OPERATING_HOURS, sat: { opens: "09:00", closes: "23:00" } },
};

describe("VenueForm (PTR-26)", () => {
  it("offers every criterion-2 field", () => {
    render(<VenueForm onSave={saveSpy()} />);

    for (const label of [
      "Venue name",
      "Location",
      "Maximum capacity",
      "Facilities",
      "Accessibility features",
    ]) {
      expect(screen.getByLabelText(label, { exact: true })).not.toBeNull();
    }
    expect(screen.getByRole("group", { name: "Supported room layouts" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Operating hours" })).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Theatre" })).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Monday" })).not.toBeNull();
    expect(screen.getByLabelText("Monday opens", { exact: true })).not.toBeNull();
  });

  it("submits a new venue with the lists split from their comma-separated inputs", async () => {
    const user = userEvent.setup();
    const onSave = saveSpy();
    render(<VenueForm onSave={onSave} />);

    fill("Venue name", "Seminar Room 2A");
    fill("Location", "Level 2");
    fill("Maximum capacity", "40");
    fill("Facilities", "Projector, Whiteboard, Projector, ");
    fill("Accessibility features", "Step-free access");
    await user.click(screen.getByRole("checkbox", { name: "Classroom" }));
    await user.click(screen.getByRole("checkbox", { name: "Boardroom" }));
    await user.click(screen.getByRole("button", { name: "Save venue" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        name: "Seminar Room 2A",
        location: "Level 2",
        maxCapacity: 40,
        facilities: ["Projector", "Whiteboard"],
        accessibilityFeatures: ["Step-free access"],
        supportedLayouts: ["classroom", "boardroom"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      });
    });
  });

  it("starts from the saved record when editing and sends the edited values", async () => {
    const user = userEvent.setup();
    const onSave = saveSpy();
    render(<VenueForm initial={harbourHall} onSave={onSave} />);

    expect(valueOf("Venue name")).toBe("Harbour Hall");
    expect(valueOf("Maximum capacity")).toBe("300");
    expect(valueOf("Facilities")).toBe("Stage, Projector");
    expect(isChecked("Theatre")).toBe(true);
    expect(isChecked("Saturday")).toBe(true);
    expect(valueOf("Saturday opens")).toBe("09:00");
    expect(isChecked("Sunday")).toBe(false);

    fill("Maximum capacity", "320");
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }));
    fill("Sunday opens", "10:00");
    fill("Sunday closes", "18:00");
    await user.click(screen.getByRole("button", { name: "Save venue" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith({
        ...harbourHall,
        maxCapacity: 320,
        operatingHours: {
          ...harbourHall.operatingHours,
          sun: { opens: "10:00", closes: "18:00" },
        },
      });
    });
  });

  /** Criterion 3 at the form: the boundary just below valid, and a non-integer. */
  it.each(["0", "2.5"])("refuses the capacity %s before saving", async maxCapacity => {
    const user = userEvent.setup();
    const onSave = saveSpy();
    render(<VenueForm initial={harbourHall} onSave={onSave} />);

    fill("Maximum capacity", maxCapacity);
    await user.click(screen.getByRole("button", { name: "Save venue" }));

    expect(await screen.findByText(CAPACITY_MESSAGE)).not.toBeNull();
    expect(
      screen.getByLabelText("Maximum capacity", { exact: true }).getAttribute("aria-invalid")
    ).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([NOT_PERMITTED_MESSAGE, DUPLICATE_NAME_MESSAGE])(
    "shows the server's own words for a refusal: %s",
    async message => {
      const user = userEvent.setup();
      const onSave = saveSpy().mockRejectedValue(new Error(message));
      render(<VenueForm initial={harbourHall} onSave={onSave} />);

      await user.click(screen.getByRole("button", { name: "Save venue" }));

      expect(await screen.findByText(message)).not.toBeNull();
      expect(screen.getByRole("button", { name: "Save venue" })).not.toBeNull();
    }
  );
});

describe("VenueDetails (PTR-26 criterion 4, read-only)", () => {
  it("renders every attribute with no editable control", () => {
    render(<VenueDetails venue={harbourHall} />);

    for (const text of [
      "Level 1, Marina Centre",
      "300",
      "Stage, Projector",
      "Step-free access",
      "Theatre, Banquet",
      "09:00 – 23:00",
    ]) {
      expect(screen.getByText(text)).not.toBeNull();
    }
    expect(screen.getAllByText("Closed")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
