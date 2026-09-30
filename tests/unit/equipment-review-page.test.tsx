import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EquipmentReviewPage } from "#/features/equipment-requests/components/equipment-review-page";
import {
  ARRANGEMENT_EMPTY_UPDATE_MESSAGE,
  ARRANGEMENT_REASON_MESSAGE,
} from "#/features/equipment-requests/schema";
import type { EventProjection } from "#/features/events/access";

const { updateEquipmentArrangement, checkEquipmentAvailability, invalidate, success } = vi.hoisted(
  () => ({
    updateEquipmentArrangement: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
    checkEquipmentAvailability: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
  })
);

vi.mock("#/features/equipment-requests/server-fns", () => ({
  updateEquipmentArrangement,
  checkEquipmentAvailability,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success } }));

type Line = NonNullable<EventProjection["event"]["equipment"]>[number];

const projector: Line = {
  id: "line-a",
  item: "Projector",
  quantity: 2,
  arrangementStatus: "requested",
  notes: "Needs HDMI",
  arrangementNotes: null,
  unavailableReason: null,
};
const microphone: Line = {
  id: "line-b",
  item: "Microphone",
  quantity: 4,
  arrangementStatus: "reserved",
  notes: null,
  arrangementNotes: "Held in store B",
  unavailableReason: null,
};
const speaker: Line = {
  id: "line-c",
  item: "Speaker",
  quantity: 1,
  arrangementStatus: "not_required",
  notes: null,
  arrangementNotes: null,
  unavailableReason: null,
};

const equipmentTypes = [
  { id: 3, name: "Projector" },
  { id: 4, name: "Microphone" },
];

function renderReview(equipment: Line[] = [projector, microphone, speaker]) {
  const event: EventProjection["event"] = {
    id: 7,
    name: "Summit",
    eventDate: "2030-01-01",
    endDate: "2030-01-01",
    startTime: "09:00",
    endTime: "17:00",
    status: "approved",
    equipment,
  };
  return render(<EquipmentReviewPage event={event} equipmentTypes={equipmentTypes} />);
}

const stateSelect = (item: string) =>
  screen.getByRole("combobox", { name: `Arrangement state for ${item}` });

async function choose(user: ReturnType<typeof userEvent.setup>, item: string, label: string) {
  await user.click(stateSelect(item));
  await user.click(await screen.findByRole("option", { name: label }));
}

async function check(user: ReturnType<typeof userEvent.setup>, quantity?: string) {
  await user.click(screen.getByRole("combobox", { name: "Equipment type" }));
  await user.click(await screen.findByRole("option", { name: "Projector" }));
  if (quantity)
    await user.type(screen.getByRole("spinbutton", { name: "Quantity (optional)" }), quantity);
  await user.click(screen.getByRole("button", { name: "Check availability" }));
}

describe("EquipmentReviewPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("shows the event, its date and times and every requested line", () => {
    renderReview();

    expect(screen.getByRole("heading", { level: 1, name: "Summit" })).toBeTruthy();
    expect(screen.getByText("1 Jan 2030")).toBeTruthy();
    expect(screen.getByText("09:00–17:00")).toBeTruthy();

    for (const [item, quantity] of [
      ["Projector", "× 2"],
      ["Microphone", "× 4"],
      ["Speaker", "× 1"],
    ]) {
      const line = screen.getByRole("listitem", { name: item });
      expect(within(line).getByText(quantity)).toBeTruthy();
    }
    // The Coordinator's own note is context, shown but not editable here.
    expect(screen.getByText("Needs HDMI")).toBeTruthy();
    expect(stateSelect("Speaker").textContent).toContain("Not required");
    expect(screen.getByRole("heading", { level: 3, name: /Projector/ })).toBeTruthy();
  });

  it("does not offer reserved as a choice", async () => {
    renderReview([projector]);

    await userEvent.setup({ pointerEventsCheck: 0 }).click(stateSelect("Projector"));
    const options = await screen.findAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      "Requested",
      "Not required",
      "Unavailable",
    ]);
    expect(screen.queryByRole("option", { name: "Reserved" })).toBeNull();
  });

  it("shows a line a colleague is arranging without a form", () => {
    renderReview([
      {
        ...projector,
        arrangementStatus: "unavailable",
        arrangementNotes: "Adapter in store B",
        unavailableReason: "Loaned out",
        arrangeable: false,
      },
      speaker,
    ]);

    const held = screen.getByRole("listitem", { name: "Projector" });
    expect(
      within(held).getByText("Being arranged by another member of Technical Support")
    ).toBeTruthy();
    expect(within(held).getByText("State: Unavailable")).toBeTruthy();
    expect(within(held).getByText("Reason: Loaned out")).toBeTruthy();
    expect(within(held).getByText("Technical Support note: Adapter in store B")).toBeTruthy();
    expect(within(held).queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Projector" })).toBeNull();
    // A line the member can arrange keeps its form.
    expect(screen.getByRole("button", { name: "Save Speaker" })).toBeTruthy();
  });

  it("names the colleague holding a line, and says when the member holds it", () => {
    renderReview([
      { ...projector, arrangeable: false, assignedStaffName: "Sam Tech" },
      { ...speaker, assignedStaffName: "Me Myself" },
      microphone,
    ]);

    expect(screen.getByText("Being arranged by Sam Tech")).toBeTruthy();
    expect(
      within(screen.getByRole("listitem", { name: "Speaker" })).getByText(
        "You are arranging this line."
      )
    ).toBeTruthy();
    // Shown on the claimed line only, not the unclaimed one nor the colleague's.
    expect(screen.getAllByText("You are arranging this line.")).toHaveLength(1);
  });

  it("disables the state choice on a reserved line and says why", () => {
    renderReview([microphone]);

    const trigger = stateSelect("Microphone");
    expect(
      trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true"
    ).toBe(true);
    const message = screen.getByText(
      "This line holds a reservation. Release the reservation before changing its state."
    );
    expect(message.id).not.toBe("");
    expect(trigger.getAttribute("aria-describedby")).toBe(message.id);
    // Notes stay editable: the rule locks the state, not the annotation.
    expect(
      screen.getByRole("textbox", { name: "Technical Support notes for Microphone" })
    ).toHaveProperty("disabled", false);
  });

  it("asks for a reason when unavailable is chosen", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([projector]);

    expect(screen.queryByRole("textbox", { name: /Reason unavailable/ })).toBeNull();
    await choose(user, "Projector", "Unavailable");
    const reason = screen.getByRole("textbox", {
      name: "Reason unavailable for Projector (required)",
    });

    await user.click(screen.getByRole("button", { name: "Save Projector" }));
    expect(await screen.findByText(ARRANGEMENT_REASON_MESSAGE)).toBeTruthy();
    expect(updateEquipmentArrangement).not.toHaveBeenCalled();

    await user.type(reason, "Loaned out");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    await waitFor(() =>
      expect(updateEquipmentArrangement).toHaveBeenCalledWith({
        data: {
          eventId: 7,
          id: "line-a",
          arrangementStatus: "unavailable",
          unavailableReason: "Loaned out",
        },
      })
    );
    expect(success).toHaveBeenCalledWith("Equipment line updated.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("leaves the state out of the update for a reserved line", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([microphone]);

    const notes = screen.getByRole("textbox", { name: "Technical Support notes for Microphone" });
    await user.clear(notes);
    await user.type(notes, "Moved to store C");
    await user.click(screen.getByRole("button", { name: "Save Microphone" }));

    await waitFor(() =>
      expect(updateEquipmentArrangement).toHaveBeenCalledWith({
        data: { eventId: 7, id: "line-b", arrangementNotes: "Moved to store C" },
      })
    );
  });

  it("sends only the note when only the note changed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([speaker]);

    await user.type(
      screen.getByRole("textbox", { name: "Technical Support notes for Speaker" }),
      "Stand included"
    );
    await user.click(screen.getByRole("button", { name: "Save Speaker" }));

    await waitFor(() =>
      expect(updateEquipmentArrangement).toHaveBeenCalledWith({
        data: { eventId: 7, id: "line-c", arrangementNotes: "Stand included" },
      })
    );
  });

  it("sends the state with its reason when only the reason changed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([{ ...projector, arrangementStatus: "unavailable", unavailableReason: "Loaned" }]);

    const reason = screen.getByRole("textbox", {
      name: "Reason unavailable for Projector (required)",
    });
    await user.clear(reason);
    await user.type(reason, "Broken");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    await waitFor(() =>
      expect(updateEquipmentArrangement).toHaveBeenCalledWith({
        data: {
          eventId: 7,
          id: "line-a",
          arrangementStatus: "unavailable",
          unavailableReason: "Broken",
        },
      })
    );
  });

  it("sends only the state when only the state changed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([{ ...projector, arrangementNotes: "Held" }]);

    await choose(user, "Projector", "Not required");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    await waitFor(() =>
      expect(updateEquipmentArrangement).toHaveBeenCalledWith({
        data: { eventId: 7, id: "line-a", arrangementStatus: "not_required" },
      })
    );
  });

  it("does not call the server when nothing changed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([projector]);

    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    expect(await screen.findByText(ARRANGEMENT_EMPTY_UPDATE_MESSAGE)).toBeTruthy();
    expect(updateEquipmentArrangement).not.toHaveBeenCalled();
  });

  it("shows the server's refusal on the line that failed", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    updateEquipmentArrangement.mockRejectedValueOnce(new Error("This line holds a reservation."));
    renderReview([projector, speaker]);

    await choose(user, "Projector", "Not required");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    const line = screen.getByRole("listitem", { name: "Projector" });
    expect(await within(line).findByText("This line holds a reservation.")).toBeTruthy();
    expect(
      within(screen.getByRole("listitem", { name: "Speaker" })).queryByRole("alert")
    ).toBeNull();
  });

  describe("availability check", () => {
    const result = {
      held: 10,
      reserved: 4,
      unavailable: 2,
      available: 4,
      requested: 6,
      shortfall: 2,
      equipmentTypeName: "Projector",
      period: { startsAt: "2030-01-01T09:00", endsAt: "2030-01-01T17:00" },
    };

    it("shows the picker placeholder before selection", () => {
      renderReview([speaker]);

      expect(screen.getByRole("combobox", { name: "Equipment type" }).textContent).toContain(
        "Choose an equipment type"
      );
    });

    it("states the shortfall and sends the requested quantity", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      checkEquipmentAvailability.mockResolvedValue(result);
      renderReview([speaker]);

      await check(user, "6");

      const outcome = await screen.findByText(
        "Projector: Short by 2: 4 available, 6 requested (1 Jan 2030, 09:00 to 1 Jan 2030, 17:00)"
      );
      expect(outcome).toBeTruthy();
      expect(screen.getByRole("status")).toBe(outcome);
      expect(outcome.className).toContain("font-medium");
      expect(checkEquipmentAvailability).toHaveBeenCalledWith({
        data: { eventId: 7, equipmentTypeId: 3, requestedQuantity: 6 },
      });
    });

    it("omits the quantity when left empty and states what is available", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      checkEquipmentAvailability.mockResolvedValue({ ...result, shortfall: 0 });
      renderReview([speaker]);

      await check(user);

      const outcome = await screen.findByText(/Projector: 4 available/);
      expect(outcome).toBeTruthy();
      expect(outcome.className).not.toContain("font-medium");
      expect(checkEquipmentAvailability).toHaveBeenCalledWith({
        data: { eventId: 7, equipmentTypeId: 3 },
      });
    });

    it("asks for a type and a whole quantity before calling the server", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderReview([speaker]);

      await user.type(screen.getByLabelText("Quantity (optional)"), "0");
      await user.click(screen.getByRole("button", { name: "Check availability" }));

      expect(await screen.findAllByText("Choose an equipment type")).toHaveLength(2);
      expect(screen.getByLabelText("Quantity (optional)").getAttribute("aria-invalid")).toBe(
        "true"
      );
      expect(checkEquipmentAvailability).not.toHaveBeenCalled();
    });

    it("shows the server's refusal inline", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      checkEquipmentAvailability.mockRejectedValue(
        new Error("The event has no approved venue booking yet")
      );
      renderReview([speaker]);

      await check(user);

      expect(await screen.findByText("The event has no approved venue booking yet")).toBeTruthy();
    });

    it("clears a shown outcome when the quantity changes", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      checkEquipmentAvailability.mockResolvedValue(result);
      renderReview([speaker]);

      await check(user, "6");
      const message =
        "Projector: Short by 2: 4 available, 6 requested (1 Jan 2030, 09:00 to 1 Jan 2030, 17:00)";
      expect(await screen.findByText(message)).toBeTruthy();

      await user.type(screen.getByRole("spinbutton", { name: "Quantity (optional)" }), "1");
      expect(screen.queryByText(message)).toBeNull();
    });

    it("clears a shown outcome when the type changes", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      checkEquipmentAvailability.mockResolvedValue(result);
      renderReview([speaker]);

      await check(user, "6");
      const message =
        "Projector: Short by 2: 4 available, 6 requested (1 Jan 2030, 09:00 to 1 Jan 2030, 17:00)";
      expect(await screen.findByText(message)).toBeTruthy();

      await user.click(screen.getByRole("combobox", { name: "Equipment type" }));
      await user.click(await screen.findByRole("option", { name: "Microphone" }));
      expect(screen.queryByText(message)).toBeNull();
    });

    it("says no types are available instead of the form when the catalogue is empty", () => {
      const event: EventProjection["event"] = {
        id: 7,
        name: "Summit",
        eventDate: "2030-01-01",
        endDate: "2030-01-01",
        startTime: "09:00",
        endTime: "17:00",
        status: "approved",
        equipment: [speaker],
      };
      render(<EquipmentReviewPage event={event} equipmentTypes={[]} />);

      expect(screen.getByRole("heading", { name: "Check availability" })).toBeTruthy();
      expect(screen.getByText("No equipment types are available.")).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: "Equipment type" })).toBeNull();
    });

    it("says the catalogue could not be loaded when it is unavailable", () => {
      const event: EventProjection["event"] = {
        id: 7,
        name: "Summit",
        eventDate: "2030-01-01",
        endDate: "2030-01-01",
        startTime: "09:00",
        endTime: "17:00",
        status: "approved",
        equipment: [speaker],
      };
      render(<EquipmentReviewPage event={event} equipmentTypes={null} />);

      expect(screen.getByText("Could not load equipment types.")).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: "Equipment type" })).toBeNull();
    });
  });
});
