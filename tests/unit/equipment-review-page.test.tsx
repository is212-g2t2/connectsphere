import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EquipmentReviewPage } from "#/features/equipment-requests/components/equipment-review-page";
import { ARRANGEMENT_REASON_MESSAGE } from "#/features/equipment-requests/schema";
import type { EventProjection } from "#/features/events/access";

const { updateEquipmentArrangement, invalidate, success } = vi.hoisted(() => ({
  updateEquipmentArrangement: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/equipment-requests/server-fns", () => ({ updateEquipmentArrangement }));
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
  return render(<EquipmentReviewPage event={event} />);
}

const stateSelect = (item: string) =>
  screen.getByRole("combobox", { name: `Arrangement state for ${item}` });

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
    expect((stateSelect("Speaker") as HTMLSelectElement).value).toBe("not_required");
  });

  it("does not offer reserved as a choice", () => {
    renderReview([projector]);

    const options = within(stateSelect("Projector")).getAllByRole("option");
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
      within(held).getByText("Being arranged by another member of Technical Support.")
    ).toBeTruthy();
    expect(within(held).getByText("Unavailable")).toBeTruthy();
    expect(within(held).getByText("Reason: Loaned out")).toBeTruthy();
    expect(within(held).getByText("Technical Support note: Adapter in store B")).toBeTruthy();
    expect(within(held).queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Projector" })).toBeNull();
    // A line the member can arrange keeps its form.
    expect(screen.getByRole("button", { name: "Save Speaker" })).toBeTruthy();
  });

  it("disables the state choice on a reserved line and says why", () => {
    renderReview([microphone]);

    expect((stateSelect("Microphone") as HTMLSelectElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "This line holds a reservation. Release the reservation before changing its state."
      )
    ).toBeTruthy();
    // Notes stay editable: the rule locks the state, not the annotation.
    expect(
      screen.getByRole("textbox", { name: "Technical Support notes for Microphone" })
    ).toHaveProperty("disabled", false);
  });

  it("asks for a reason when unavailable is chosen", async () => {
    const user = userEvent.setup();
    updateEquipmentArrangement.mockResolvedValue({});
    renderReview([projector]);

    expect(screen.queryByRole("textbox", { name: /Reason unavailable/ })).toBeNull();
    await user.selectOptions(stateSelect("Projector"), "unavailable");
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
          arrangementNotes: "",
        },
      })
    );
    expect(success).toHaveBeenCalledWith("Equipment line updated.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("leaves the state out of the update for a reserved line", async () => {
    const user = userEvent.setup();
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

  it("shows the server's refusal on the line that failed", async () => {
    const user = userEvent.setup();
    updateEquipmentArrangement.mockRejectedValueOnce(new Error("This line holds a reservation."));
    renderReview([projector, speaker]);

    await user.selectOptions(stateSelect("Projector"), "not_required");
    await user.click(screen.getByRole("button", { name: "Save Projector" }));

    const line = screen.getByRole("listitem", { name: "Projector" });
    expect(await within(line).findByText("This line holds a reservation.")).toBeTruthy();
    expect(
      within(screen.getByRole("listitem", { name: "Speaker" })).queryByRole("alert")
    ).toBeNull();
  });
});
