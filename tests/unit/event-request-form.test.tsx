// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EventRequestForm } from "#/features/event-requests/components/request-form";
import type { EventRequestFormSubmitContext } from "#/features/event-requests/components/request-form";
import {
  REGISTRATION_CAPACITY_MESSAGE,
  REGISTRATION_CAPACITY_REQUIRED_MESSAGE,
  REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE,
  REGISTRATION_CLOSES_REQUIRED_MESSAGE,
  REGISTRATION_OPENS_REQUIRED_MESSAGE,
} from "#/features/event-requests/schema";
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
  registrationEnabled: false,
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
  registrationEnabled: false,
};

const ENABLED_REGISTRATION = {
  registrationEnabled: true,
  registrationCapacity: 50,
  registrationOpensAt: "2030-11-01T09:00",
  registrationClosesAt: "2030-11-08T17:00",
};

function makeOnSave() {
  return vi
    .fn<
      (values: EventRequestDraftValues, context: EventRequestFormSubmitContext) => Promise<void>
    >()
    .mockResolvedValue(undefined);
}

function makeOnSubmitRequest() {
  return vi
    .fn<
      (values: EventRequestDraftValues, context: EventRequestFormSubmitContext) => Promise<void>
    >()
    .mockResolvedValue(undefined);
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

    fill("Event name", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        {
          ...BLANK_DRAFT,
          eventName: "Community workshop",
        },
        expect.anything()
      );
    });
  });

  it("drops an equipment line left entirely blank", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        {
          ...BLANK_DRAFT,
          eventName: "Community workshop",
        },
        expect.anything()
      );
    });
  });

  it("loads every captured value exactly and submits it untouched", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    const displayedValues = {
      "Event name": initialValues.eventName,
      Purpose: initialValues.purpose,
      "Expected attendance": "125",
      Description: initialValues.description,
      "Special arrangements (optional)": initialValues.specialArrangements,
      "Proposed start 1": "2030-11-18T09:30",
      "Proposed end 1": "2030-11-18T12:45",
      "Proposed start 2": "2030-11-20T14:15",
      "Proposed end 2": "2030-11-20T17:30",
      "Equipment type 1": "  Wireless microphones  ",
      "Quantity 1": "2",
      "Equipment type 2": "HDMI projector & screen",
      "Quantity 2": "1",
    };
    for (const [label, value] of Object.entries(displayedValues)) {
      expect(inputValue(label)).toBe(value);
    }

    // The four controlled fields keep the stored text. None of these values is in the new
    // vocabulary, so each opens as "Other" with the original text intact.
    expect(inputValue("Type of event: other")).toBe(initialValues.eventType);
    expect(inputValue("Room-layout preference: other")).toBe(initialValues.roomLayoutPreference);
    expect(inputValue("Venue requirements: other")).toBe(initialValues.venueRequirements);
    expect(inputValue("Accessibility requirements: other")).toBe(
      initialValues.accessibilityRequirements
    );
    expect(
      screen.getByRole("combobox", { name: "Type of event (optional)" }).textContent
    ).toContain("Other");
    expect(screen.getByRole("combobox", { name: "Room-layout preference" }).textContent).toContain(
      "Other"
    );

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(initialValues, expect.anything());
  });

  it("submits added proposed dates and equipment lines", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name", "Workshop");
    await user.click(screen.getByRole("button", { name: "Add proposed date" }));
    fill("Proposed start 1", "2030-11-18T09:30");
    fill("Proposed end 1", "2030-11-18T11:00");
    fill("Proposed start 2", "2030-11-19T13:00");
    fill("Proposed end 2", "2030-11-19T15:30");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 1", "Projector");
    fill("Quantity 1", "1");
    await user.click(screen.getByRole("button", { name: "Add equipment" }));
    fill("Equipment type 2", "Microphone");
    fill("Quantity 2", "2");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        {
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
        },
        expect.anything()
      );
    });
  });

  it.each([
    ["Proposed end 1", "2030-11-18T09:30", "later than the start"],
    ["Proposed end 1", "2030-11-18T09:29", "later than the start"],
    ["Proposed end 2", "2030-11-20T14:15", "later than the start"],
    ["Expected attendance", "0", "positive whole number"],
    ["Expected attendance", "-1", "positive whole number"],
    ["Expected attendance", "1.5", "positive whole number"],
    ["Expected attendance", "1.0000000000000001", "positive whole number"],
    ["Quantity 1", "0", "positive whole number"],
    ["Quantity 1", "1.0000000000000001", "positive whole number"],
  ])("refuses to save when %s is %s", async (label, value, error) => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    fill(label, value);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByLabelText(label, { exact: true }).getAttribute("aria-invalid")).toBe("true");
    expect(
      screen
        .getAllByRole("alert")
        .map(alert => alert.textContent ?? "")
        .some(text => text.includes(error))
    ).toBe(true);
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

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      { ...initialValues, equipmentRequirements },
      expect.anything()
    );
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

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      {
        ...initialValues,
        equipmentRequirements: [
          { type: "  Wireless microphones  ", quantity: 2 },
          { type: "Speakers", quantity: 3 },
        ],
      },
      expect.anything()
    );
  });

  it("displays a save failure and retains the entered requirements for another attempt", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<
        (values: EventRequestDraftValues, context: EventRequestFormSubmitContext) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("Could not save this draft. Try again."))
      .mockResolvedValue(undefined);
    render(<EventRequestForm initialValues={initialValues} onSave={onSave} />);

    const description = "  Updated workshop notes\nKeep these even when saving fails.  ";
    fill("Description", description);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Could not save this draft. Try again.");
    });
    expect(inputValue("Description")).toBe(description);
    expect(inputValue("Event name")).toBe(initialValues.eventName);
    expect(inputValue("Proposed start 2")).toBe("2030-11-20T14:15");
    expect(inputValue("Equipment type 1")).toBe("  Wireless microphones  ");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ ...initialValues, description }, expect.anything());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the registration terms until registration is enabled", () => {
    render(<EventRequestForm onSave={makeOnSave()} />);

    expect(
      screen
        .getByRole("checkbox", { name: "Require attendee registration" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.queryByLabelText("Registration capacity", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Registration opens", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("Registration closes", { exact: true })).toBeNull();
  });

  it("saves the registration terms exactly as entered", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    fill("Event name", "Workshop");
    await user.click(screen.getByRole("checkbox", { name: "Require attendee registration" }));
    fill("Registration capacity", "50");
    fill("Registration opens", ENABLED_REGISTRATION.registrationOpensAt);
    fill("Registration closes", ENABLED_REGISTRATION.registrationClosesAt);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        {
          ...BLANK_DRAFT,
          eventName: "Workshop",
          ...ENABLED_REGISTRATION,
        },
        expect.anything()
      );
    });
  });

  it("refuses to save an enabled registration missing its terms, naming each", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Require attendee registration" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(
      screen
        .getAllByRole("alert")
        .filter(alert => alert.getAttribute("data-slot") === "field-error")
        .map(alert => alert.textContent)
    ).toEqual([
      REGISTRATION_CAPACITY_REQUIRED_MESSAGE,
      REGISTRATION_OPENS_REQUIRED_MESSAGE,
      REGISTRATION_CLOSES_REQUIRED_MESSAGE,
    ]);
    for (const label of ["Registration capacity", "Registration opens", "Registration closes"]) {
      expect(screen.getByLabelText(label, { exact: true }).getAttribute("aria-invalid")).toBe(
        "true"
      );
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports an unusable registration capacity at its field", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Require attendee registration" }));
    fill("Registration capacity", "2.5");
    fill("Registration opens", ENABLED_REGISTRATION.registrationOpensAt);
    fill("Registration closes", ENABLED_REGISTRATION.registrationClosesAt);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByText(REGISTRATION_CAPACITY_MESSAGE)).not.toBeNull();
    expect(
      screen.getByLabelText("Registration capacity", { exact: true }).getAttribute("aria-invalid")
    ).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports a registration window that closes before it opens", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Require attendee registration" }));
    fill("Registration capacity", "50");
    fill("Registration opens", "2030-11-08T17:00");
    fill("Registration closes", "2030-11-08T16:59");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByText(REGISTRATION_CLOSES_BEFORE_OPENS_MESSAGE)).not.toBeNull();
    expect(
      screen.getByLabelText("Registration closes", { exact: true }).getAttribute("aria-invalid")
    ).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("loads saved registration terms exactly and submits them untouched", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, ...ENABLED_REGISTRATION }}
        onSave={onSave}
      />
    );

    expect(
      screen
        .getByRole("checkbox", { name: "Require attendee registration" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(inputValue("Registration capacity")).toBe("50");
    expect(inputValue("Registration opens")).toBe(ENABLED_REGISTRATION.registrationOpensAt);
    expect(inputValue("Registration closes")).toBe(ENABLED_REGISTRATION.registrationClosesAt);

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      { ...initialValues, ...ENABLED_REGISTRATION },
      expect.anything()
    );
  });

  it("drops the terms when registration is turned off before saving", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    const toggle = screen.getByRole("checkbox", { name: "Require attendee registration" });
    await user.click(toggle);
    fill("Registration capacity", "50");
    fill("Registration opens", ENABLED_REGISTRATION.registrationOpensAt);
    fill("Registration closes", ENABLED_REGISTRATION.registrationClosesAt);
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(BLANK_DRAFT, expect.anything());
    });
  });

  it("offers no submit control to a caller that only saves", () => {
    render(<EventRequestForm onSave={makeOnSave()} />);

    expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  });

  it("stores checked options as one string and lets None replace them", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    const power = screen.getByRole("checkbox", { name: "Power outlets" });
    const parking = screen.getByRole("checkbox", { name: "Parking" });
    const stepFree = screen.getByRole("checkbox", { name: "Step-free access" });
    const none = screen.getByRole("checkbox", { name: "None" });

    await user.click(power);
    await user.click(parking);
    await user.click(stepFree);
    expect(power.getAttribute("aria-checked")).toBe("true");
    expect(parking.getAttribute("aria-checked")).toBe("true");
    expect(stepFree.getAttribute("aria-checked")).toBe("true");

    await user.click(none);
    expect(none.getAttribute("aria-checked")).toBe("true");
    expect(stepFree.getAttribute("aria-checked")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      venueRequirements: "Power outlets; Parking",
      accessibilityRequirements: "None",
    });
  });

  it("clears None when another accessibility option is chosen", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    const none = screen.getByRole("checkbox", { name: "None" });
    const toilet = screen.getByRole("checkbox", { name: "Accessible toilet" });

    await user.click(none);
    expect(none.getAttribute("aria-checked")).toBe("true");

    await user.click(toilet);
    expect(toilet.getAttribute("aria-checked")).toBe("true");
    expect(none.getAttribute("aria-checked")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].accessibilityRequirements).toBe("Accessible toilet");
  });

  it("keeps Other text and selected options in one value", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(<EventRequestForm onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Power outlets" }));
    const venueGroup = screen.getByRole("group", { name: "Venue requirements" });
    await user.click(within(venueGroup).getByRole("checkbox", { name: "Other" }));
    await user.type(screen.getByLabelText("Venue requirements: other"), "Near the MRT");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].venueRequirements).toBe("Power outlets; Near the MRT");
  });

  it("replaces a stored None when another accessibility option is chosen", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, accessibilityRequirements: "None" }}
        onSave={onSave}
      />
    );

    expect(screen.getByRole("checkbox", { name: "None" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(screen.queryByLabelText("Accessibility requirements: other")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Step-free access" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].accessibilityRequirements).toBe("Step-free access");
  });

  it("keeps legacy Other text before a newly chosen option", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, venueRequirements: "Ground floor" }}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Parking" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].venueRequirements).toBe("Ground floor; Parking");
  });

  it("groups the form and explains None for accessibility", () => {
    render(<EventRequestForm onSave={makeOnSave()} />);

    expect(screen.getByRole("region", { name: "Event details" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Requirements" })).toBeTruthy();
    expect(screen.getByText("Choose None if there are no accessibility needs.")).toBeTruthy();
  });

  it("routes Submit request to the submission handler and leaves the save handler alone", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    const onSubmitRequest = makeOnSubmitRequest();
    render(<EventRequestForm onSave={onSave} onSubmitRequest={onSubmitRequest} />);

    fill("Event name", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(onSubmitRequest).toHaveBeenCalledExactlyOnceWith(
        {
          ...BLANK_DRAFT,
          eventName: "Community workshop",
        },
        expect.anything()
      );
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("routes Save draft to the save handler even when submission is available", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    const onSubmitRequest = makeOnSubmitRequest();
    render(<EventRequestForm onSave={onSave} onSubmitRequest={onSubmitRequest} />);

    fill("Event name", "Community workshop");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        {
          ...BLANK_DRAFT,
          eventName: "Community workshop",
        },
        expect.anything()
      );
    });
    expect(onSubmitRequest).not.toHaveBeenCalled();
  });

  it("shows a refused submission on the form and keeps the entered values", async () => {
    const user = userEvent.setup();
    const onSubmitRequest = makeOnSubmitRequest().mockRejectedValueOnce(
      new Error("This request is missing: Event name")
    );
    render(<EventRequestForm onSave={makeOnSave()} onSubmitRequest={onSubmitRequest} />);

    fill("Description", "  Keep this draft note  ");
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("This request is missing: Event name");
    });
    expect(inputValue("Description")).toBe("  Keep this draft note  ");
  });

  it("leads with the reply body and the editable fields, folding the rest into a collapsed block", () => {
    render(
      <EventRequestForm
        initialValues={initialValues}
        editableFields={["expectedAttendance"]}
        replyBody={{ label: "Your reply" }}
        onSave={makeOnSave()}
      />
    );

    expect(screen.getByLabelText("Your reply").closest("details")).toBeNull();
    expect(screen.getByLabelText("Expected attendance").closest("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Save draft" }).closest("details")).toBeNull();
    expect(screen.getByLabelText("Event name").closest("details")).not.toBeNull();
    expect(screen.getByLabelText("Purpose").closest("details")).not.toBeNull();
    expect(screen.getByText("Other request details (read-only)")).toBeTruthy();
  });

  it("reports the top-level names of only the fields the organiser changed", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    render(
      <EventRequestForm
        initialValues={initialValues}
        editableFields={["expectedAttendance", "roomLayoutPreference", "proposedDates"]}
        onSave={onSave}
      />
    );

    fill("Proposed start 1", "2030-11-18T08:00");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const context = onSave.mock.calls[0][1];
    expect(context.changedFields).toContain("proposedDates");
    expect(context.changedFields).not.toContain("expectedAttendance");
    expect(context.changedFields).not.toContain("roomLayoutPreference");
    expect(context.replyBody).toBe("");
  });

  it("keeps the edited field and the reply body when a fresh snapshot is handed to the same form", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    const replyForm = (values: EventRequestDraftValues) => (
      <EventRequestForm
        initialValues={values}
        editableFields={["expectedAttendance", "roomLayoutPreference"]}
        replyBody={{ label: "Your reply" }}
        onSave={onSave}
      />
    );
    const { rerender } = render(replyForm(initialValues));

    await user.click(screen.getByRole("combobox", { name: "Room-layout preference" }));
    await user.click(await screen.findByRole("option", { name: "Boardroom" }));
    await user.type(screen.getByLabelText("Your reply"), "Please use a boardroom.");

    rerender(
      replyForm({ ...initialValues, expectedAttendance: 120, roomLayoutPreference: "Classroom" })
    );

    // The form owns its values for this mount. The reply and the organiser's own edits survive.
    expect(inputValue("Expected attendance")).toBe("125");
    expect(screen.getByRole("combobox", { name: "Room-layout preference" }).textContent).toContain(
      "Boardroom"
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Your reply").value).toBe(
      "Please use a boardroom."
    );
  });

  it("reports only the touched field after a re-render hands the form a new copy of its record", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    const draftForm = (values: EventRequestDraftValues) => (
      <EventRequestForm initialValues={values} onSave={onSave} />
    );
    const { rerender } = render(draftForm(initialValues));

    await user.click(screen.getByRole("combobox", { name: "Room-layout preference" }));
    await user.click(await screen.findByRole("option", { name: "Boardroom" }));
    rerender(
      draftForm({
        ...initialValues,
        eventName: "Renamed elsewhere",
        proposedDates: initialValues.proposedDates.map(window => ({ ...window })),
        equipmentRequirements: initialValues.equipmentRequirements.map(line => ({ ...line })),
      })
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    // The defaults stay fixed for the mount. Neither the new copy nor its rows count as changes.
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][1].changedFields).toEqual(["roomLayoutPreference"]);
  });

  it("starts a freshly mounted reply form from the snapshot it is given", () => {
    render(
      <EventRequestForm
        initialValues={{ ...initialValues, expectedAttendance: 120 }}
        editableFields={["expectedAttendance", "roomLayoutPreference", "venueRequirements"]}
        replyBody={{ label: "Your reply" }}
        onSave={makeOnSave()}
      />
    );

    expect(inputValue("Expected attendance")).toBe("120");
    expect(inputValue("Room-layout preference: other")).toBe(initialValues.roomLayoutPreference);
    expect(inputValue("Venue requirements: other")).toBe(initialValues.venueRequirements);
    expect(inputValue("Your reply")).toBe("");
  });

  it("reports through onDirtyChange once a field differs from its mount default", async () => {
    const onDirtyChange = vi.fn<(dirty: boolean) => void>();
    render(
      <EventRequestForm
        initialValues={initialValues}
        onSave={makeOnSave()}
        onDirtyChange={onDirtyChange}
      />
    );

    fill("Event name", "Renamed workshop");

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    fill("Event name", initialValues.eventName);

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("puts Submit request before Save draft, with Submit as the primary action", () => {
    render(<EventRequestForm onSave={makeOnSave()} onSubmitRequest={makeOnSubmitRequest()} />);

    const buttons = screen.getAllByRole("button", { name: /Submit request|Save draft/ });
    expect(buttons.map(button => button.textContent)).toEqual(["Submit request", "Save draft"]);
    // The primary action keeps the solid treatment; Save draft stays quiet.
    expect(buttons[0].className).toContain("bg-primary");
    expect(buttons[1].className).toContain("bg-background");
  });

  it("shows an error summary above the actions and focuses the first invalid field on submit", async () => {
    const user = userEvent.setup();
    render(
      <EventRequestForm
        onSave={makeOnSave()}
        onSubmitRequest={makeOnSubmitRequest()}
        requireComplete
      />
    );

    await user.click(screen.getByRole("button", { name: "Submit request" }));

    const summaryText = await screen.findByText(/problems/);
    const summary = summaryText.closest('[role="alert"]');
    expect(summary?.querySelector("a")?.getAttribute("href")).toBe("#eventName");
    expect(document.activeElement).toBe(screen.getByLabelText("Event name", { exact: true }));
    expect(screen.getByRole("button", { name: "Submit request" })).toBeTruthy();
  });
});
