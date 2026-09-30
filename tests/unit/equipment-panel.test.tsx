import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EquipmentPanel } from "#/features/equipment-requests/components/equipment-panel";
import type { EquipmentLine } from "#/features/equipment-requests/schema";

const { saveEquipmentLine, removeEquipmentLine, submitEquipmentRequest, invalidate, success } =
  vi.hoisted(() => ({
    saveEquipmentLine: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
    removeEquipmentLine: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
    submitEquipmentRequest: vi.fn<() => Promise<unknown>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
  }));

vi.mock("#/features/equipment-requests/server-fns", () => ({
  saveEquipmentLine,
  removeEquipmentLine,
  submitEquipmentRequest,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

const projector: EquipmentLine = { id: "line-a", item: "Projector", quantity: 2, notes: null };
const microphone: EquipmentLine = { id: "line-b", item: "Microphone", quantity: 1, notes: null };

function renderPanel(lines: EquipmentLine[] = [projector]) {
  return render(<EquipmentPanel eventId={7} lines={lines} status="approved" submittedAt={null} />);
}

describe("EquipmentPanel error paths (PTR-38)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("shows a failed submit's error inside the still-open dialog", async () => {
    const user = userEvent.setup();
    submitEquipmentRequest.mockRejectedValueOnce(new Error("Equipment request already submitted."));
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Submit to Technical Support" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Equipment request already submitted.");
    // A failure keeps the dialog open, so the message has to render inside it.
    expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows a failed remove error only in the line's own dialog", async () => {
    const user = userEvent.setup();
    removeEquipmentLine.mockImplementationOnce(async ({ data }) => {
      if (data.id === projector.id) throw new Error("Could not remove Projector.");
      return {};
    });
    renderPanel([projector, microphone]);

    await user.click(screen.getByRole("button", { name: "Remove Projector" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not remove Projector.");
    expect(screen.getByRole("alertdialog").contains(alert)).toBe(true);

    // Close A, open B: the panel-scoped error must not follow into B's dialog.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove Microphone" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes the dialog after a successful submit", async () => {
    const user = userEvent.setup();
    submitEquipmentRequest.mockResolvedValueOnce({
      lineCount: 1,
      recipientCount: 1,
      failedCount: 0,
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Submit to Technical Support" }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(success).toHaveBeenCalled();
  });
});

describe("EquipmentPanel arrangement position (PTR-39 AC4)", () => {
  it("shows each line's arrangement state, Technical Support note and unavailable reason", () => {
    const lines: EquipmentLine[] = [
      {
        ...projector,
        arrangementStatus: "unavailable",
        arrangementNotes: "Adapter in store B",
        unavailableReason: "Loaned out",
      },
      { ...microphone, arrangementStatus: "not_required" },
    ];
    render(
      <EquipmentPanel
        eventId={7}
        lines={lines}
        status="approved"
        submittedAt="2030-01-01T00:00:00.000Z"
      />
    );

    expect(screen.getByText("State: Unavailable")).toBeTruthy();
    expect(screen.getByText("Reason: Loaned out")).toBeTruthy();
    expect(screen.getByText("Technical Support note: Adapter in store B")).toBeTruthy();
    expect(screen.getByText("State: Not required")).toBeTruthy();
  });

  it("shows no arrangement position before the request is submitted", () => {
    const line: EquipmentLine = {
      ...projector,
      arrangementStatus: "unavailable",
      arrangementNotes: "Adapter in store B",
      unavailableReason: "Loaned out",
    };
    renderPanel([line]);

    expect(screen.queryByText(/State:/)).toBeNull();
    expect(screen.queryByText(/Reason:/)).toBeNull();
    expect(screen.queryByText(/Technical Support note:/)).toBeNull();
  });
});
