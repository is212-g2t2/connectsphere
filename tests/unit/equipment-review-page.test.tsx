import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EquipmentReviewPage } from "#/features/equipment-requests/components/equipment-review-page";
import {
  ARRANGEMENT_EMPTY_UPDATE_MESSAGE,
  ARRANGEMENT_REASON_MESSAGE,
} from "#/features/equipment-requests/schema";
import type { EventProjection } from "#/features/events/access";

const {
  updateEquipmentArrangement,
  recordEquipmentUnavailable,
  completeEquipmentArrangements,
  checkEquipmentAvailability,
  reserveEquipment,
  releaseEquipment,
  checkLineAvailability,
  invalidate,
  success,
} = vi.hoisted(() => ({
  updateEquipmentArrangement: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  recordEquipmentUnavailable: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  completeEquipmentArrangements: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  checkEquipmentAvailability: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  reserveEquipment: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  releaseEquipment: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  checkLineAvailability: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/equipment-requests/server-fns", () => ({
  updateEquipmentArrangement,
  recordEquipmentUnavailable,
  completeEquipmentArrangements,
  checkEquipmentAvailability,
  reserveEquipment,
  releaseEquipment,
  checkLineAvailability,
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

function renderReview(
  equipment: Line[] = [projector, microphone, speaker],
  access: EventProjection["access"] = "technical_support",
  completedAt?: string | null
) {
  const event: EventProjection["event"] = {
    id: 7,
    name: "Summit",
    eventDate: "2030-01-01",
    endDate: "2030-01-01",
    startTime: "09:00",
    endTime: "17:00",
    status: "approved",
    equipment,
    equipmentArrangementsCompletedAt: completedAt,
  };
  return render(
    <EquipmentReviewPage event={event} access={access} equipmentTypes={equipmentTypes} />
  );
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

  it("shows the reserved count on a line holding a reservation", () => {
    renderReview([{ ...projector, reservedQuantity: 2 }]);

    expect(
      within(screen.getByRole("listitem", { name: "Projector" })).getByText("· 2 reserved")
    ).toBeTruthy();
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
      "This line holds a reservation and its state cannot be changed."
    );
    expect(message.id).not.toBe("");
    expect(trigger.getAttribute("aria-describedby")).toBe(message.id);
    // Notes stay editable: the rule locks the state, not the annotation.
    expect(
      screen.getByRole("textbox", { name: "Technical Support notes for Microphone" })
    ).toHaveProperty("disabled", false);
  });

  it("disables the state choice on a partially reserved line too", () => {
    renderReview([{ ...projector, reservedQuantity: 1 }]);

    const trigger = stateSelect("Projector");
    expect(
      trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true"
    ).toBe(true);
    const message = screen.getByText(
      "This line holds a reservation and its state cannot be changed."
    );
    expect(message.id).not.toBe("");
    expect(trigger.getAttribute("aria-describedby")).toBe(message.id);
    expect(
      screen.getByRole("textbox", { name: "Technical Support notes for Projector" })
    ).toHaveProperty("disabled", false);
  });

  it("asks for a reason when unavailable is chosen", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    recordEquipmentUnavailable.mockResolvedValue({});
    renderReview([projector]);

    expect(screen.queryByRole("textbox", { name: /Reason unavailable/ })).toBeNull();
    await choose(user, "Projector", "Unavailable");
    const reason = screen.getByRole("textbox", {
      name: "Reason unavailable for Projector (required)",
    });

    await user.click(screen.getByRole("button", { name: "Save Projector" }));
    expect(await screen.findByText(ARRANGEMENT_REASON_MESSAGE)).toBeTruthy();
    expect(recordEquipmentUnavailable).not.toHaveBeenCalled();

    await user.type(reason, "Loaned out");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    await waitFor(() =>
      expect(recordEquipmentUnavailable).toHaveBeenCalledWith({
        data: {
          eventId: 7,
          id: "line-a",
          reason: "Loaned out",
        },
      })
    );
    expect(success).toHaveBeenCalledWith("Equipment line updated.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("marks arrangements complete and refreshes the event", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    completeEquipmentArrangements.mockResolvedValue({});
    renderReview([microphone, speaker]);

    await user.click(screen.getByRole("button", { name: "Mark arrangements complete" }));

    await waitFor(() =>
      expect(completeEquipmentArrangements).toHaveBeenCalledWith({ data: { eventId: 7 } })
    );
    expect(success).toHaveBeenCalledWith("Technical arrangements marked complete.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows a completion refusal without hiding the action", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    completeEquipmentArrangements.mockRejectedValueOnce(
      new Error("Cannot mark arrangements complete: Projector is not arranged.")
    );
    renderReview([projector]);

    await user.click(screen.getByRole("button", { name: "Mark arrangements complete" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Cannot mark arrangements complete: Projector is not arranged."
    );
    expect(screen.getByRole("button", { name: "Mark arrangements complete" })).toBeTruthy();
  });

  it("shows the recorded completion and hides the action", () => {
    renderReview([microphone], "technical_support", "2026-10-01T00:00:00.000Z");

    expect(screen.getByRole("status").textContent).toContain("Technical arrangements complete.");
    expect(screen.queryByRole("button", { name: "Mark arrangements complete" })).toBeNull();
  });

  it("does not offer completion for coordinators or events without lines", () => {
    const { rerender } = renderReview([microphone], "coordinator");
    expect(screen.queryByRole("button", { name: "Mark arrangements complete" })).toBeNull();

    rerender(
      <EquipmentReviewPage
        event={{
          id: 7,
          status: "approved",
          eventDate: null,
          startTime: null,
          endTime: null,
          equipment: [],
        }}
        access="technical_support"
        equipmentTypes={equipmentTypes}
      />
    );
    expect(screen.queryByRole("button", { name: "Mark arrangements complete" })).toBeNull();
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
      expect(recordEquipmentUnavailable).toHaveBeenCalledWith({
        data: { eventId: 7, id: "line-a", reason: "Broken" },
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
      render(<EquipmentReviewPage event={event} access="technical_support" equipmentTypes={[]} />);

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
      render(
        <EquipmentReviewPage event={event} access="technical_support" equipmentTypes={null} />
      );

      expect(screen.getByText("Could not load equipment types.")).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: "Equipment type" })).toBeNull();
    });
  });
});

const releaseButton = (item: string) =>
  screen.queryByRole("button", { name: `Reduce or release equipment for ${item}` });

describe("EquipmentReviewPage reduce or release (PTR-42)", () => {
  beforeEach(() => {
    releaseEquipment.mockReset();
    invalidate.mockReset();
    success.mockReset();
  });

  it("offers the action only on a line holding units", () => {
    renderReview([projector, { ...microphone, reservedQuantity: 4 }]);

    expect(releaseButton("Projector")).toBeNull();
    expect(releaseButton("Microphone")).toBeTruthy();
  });

  it("does not offer the action on a colleague's line", () => {
    renderReview([
      { ...microphone, reservedQuantity: 4, arrangeable: false, assignedStaffName: "Ana" },
    ]);

    expect(releaseButton("Microphone")).toBeNull();
  });

  it("releases everything by default and reports the state (AC1)", async () => {
    releaseEquipment.mockResolvedValue({
      released: true,
      previousQuantity: 4,
      quantity: 0,
      arrangementStatus: "requested",
      notificationQueued: true,
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...microphone, reservedQuantity: 4 }]);

    await user.click(releaseButton("Microphone") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Currently reserved:").nextSibling?.textContent).toBe("4");
    expect(
      within(dialog).getByText(
        "0 releases the reservation. 1 to 3 keeps that many reserved and releases the rest."
      )
    ).toBeTruthy();
    expect(within(dialog).getByLabelText("Units to keep reserved")).toHaveProperty("value", "0");
    // The button names the outcome, so a full release is never a neutral confirm.
    await user.click(within(dialog).getByRole("button", { name: "Release all 4 units" }));

    await waitFor(() =>
      expect(releaseEquipment).toHaveBeenCalledWith({
        data: { equipmentRequestId: "line-b", quantity: 0, unavailableReason: "" },
      })
    );
    expect(success).toHaveBeenCalledWith(
      "Released all 4 × Microphone — the line is Requested. The Coordinator will be notified."
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("sends a reduction, naming what is kept, and says when there is no Coordinator to notify", async () => {
    releaseEquipment.mockResolvedValue({
      released: false,
      previousQuantity: 4,
      quantity: 1,
      arrangementStatus: "requested",
      notificationQueued: false,
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...microphone, reservedQuantity: 4 }]);

    await user.click(releaseButton("Microphone") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const quantity = within(dialog).getByLabelText("Units to keep reserved");
    await user.clear(quantity);
    await user.type(quantity, "1");
    await user.click(within(dialog).getByRole("button", { name: "Keep 1 unit, release 3" }));

    await waitFor(() =>
      expect(releaseEquipment).toHaveBeenCalledWith({
        data: { equipmentRequestId: "line-b", quantity: 1, unavailableReason: "" },
      })
    );
    expect(success).toHaveBeenCalledWith(
      "Reduced Microphone from 4 to 1 — the line is Requested. No Coordinator to notify; tell them yourself."
    );
  });

  it("sends a full release with its reason and names the Unavailable state", async () => {
    releaseEquipment.mockResolvedValue({
      released: true,
      previousQuantity: 4,
      quantity: 0,
      arrangementStatus: "unavailable",
      notificationQueued: true,
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...microphone, reservedQuantity: 4 }]);

    await user.click(releaseButton("Microphone") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Reason the line is unavailable (optional)"),
      "All four recalled by the supplier"
    );
    await user.click(within(dialog).getByRole("button", { name: "Release all 4 units" }));

    await waitFor(() =>
      expect(releaseEquipment).toHaveBeenCalledWith({
        data: {
          equipmentRequestId: "line-b",
          quantity: 0,
          unavailableReason: "All four recalled by the supplier",
        },
      })
    );
    expect(success).toHaveBeenCalledWith(
      "Released all 4 × Microphone — the line is Unavailable. The Coordinator will be notified."
    );
  });

  it("disables the reason on a reduction and clears a reason typed at full release", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...microphone, reservedQuantity: 4 }]);

    await user.click(releaseButton("Microphone") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText("Reason the line is unavailable (optional)");
    expect(reason).toHaveProperty("disabled", false);
    await user.type(reason, "Recalled");

    const quantity = within(dialog).getByLabelText("Units to keep reserved");
    await user.clear(quantity);
    await user.type(quantity, "2");

    expect(reason).toHaveProperty("disabled", true);
    expect(reason).toHaveProperty("value", "");
    expect(
      within(dialog).getByText(
        "A reason goes with a full release only — keep 0 units to mark the line Unavailable."
      )
    ).toBeTruthy();
  });

  it("shows the last release on the line", () => {
    renderReview([
      {
        ...microphone,
        reservedQuantity: 1,
        lastRelease: { quantity: 2, byName: "Sam Tech", at: "2026-10-01T09:00:00.000Z" },
      },
    ]);

    expect(screen.getByText(/Last release: 2 units given back by Sam Tech on/)).toBeTruthy();
  });

  it("tells a one-unit line there is nothing to reduce to", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...projector, quantity: 1, reservedQuantity: 1 }]);

    await user.click(releaseButton("Projector") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "This line holds one unit, so 0 releases it; there is nothing to reduce to."
      )
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Release all 1 unit" })).toBeTruthy();
  });

  it("marks the quantity before calling the server, and shows the server's refusal on it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderReview([{ ...microphone, reservedQuantity: 4 }]);

    await user.click(releaseButton("Microphone") as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    const quantity = within(dialog).getByLabelText("Units to keep reserved");
    await user.clear(quantity);
    await user.type(quantity, "1.5");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    expect(
      await within(dialog).findByText("Enter the units to keep as a whole number, 0 to release")
    ).toBeTruthy();
    expect(releaseEquipment).not.toHaveBeenCalled();

    releaseEquipment.mockRejectedValue(
      new Error("Enter fewer units than are currently reserved; use Reserve to hold more")
    );
    await user.clear(quantity);
    await user.type(quantity, "4");
    await user.click(within(dialog).getByRole("button", { name: "Confirm change" }));
    expect(
      await within(dialog).findByText(
        "Enter fewer units than are currently reserved; use Reserve to hold more"
      )
    ).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
