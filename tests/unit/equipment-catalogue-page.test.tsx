// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EquipmentCataloguePage } from "#/features/equipment-requests/components/equipment-catalogue-page";

const { saveEquipmentType, deleteEquipmentType, saveEquipmentUnavailability, invalidate, success } =
  vi.hoisted(() => ({
    saveEquipmentType: vi.fn<() => Promise<unknown>>(),
    deleteEquipmentType: vi.fn<() => Promise<unknown>>(),
    saveEquipmentUnavailability: vi.fn<() => Promise<unknown>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
  }));

vi.mock("#/features/equipment-requests/server-fns", () => ({
  saveEquipmentType,
  deleteEquipmentType,
  saveEquipmentUnavailability,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success } }));

function renderPage() {
  render(
    <EquipmentCataloguePage
      types={[{ id: 7, name: "Projector", quantityHeld: 5, totalUnavailable: 0, unavailable: [] }]}
    />
  );
}

async function saveOutOfService(reason: string, quantity: string) {
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText("Reason (required)"), reason);
  fireEvent.change(screen.getByLabelText("Quantity (required)"), { target: { value: quantity } });
  await user.click(screen.getByRole("button", { name: "Save out-of-service units" }));
}

describe("equipment catalogue out-of-service toast (PTR-162)", () => {
  beforeEach(() => {
    saveEquipmentUnavailability.mockResolvedValue({});
    invalidate.mockResolvedValue();
  });

  it('treats "00" as clearing the reason', async () => {
    await saveOutOfService("Maintenance", "00");

    await waitFor(() =>
      expect(saveEquipmentUnavailability).toHaveBeenCalledWith({
        data: { equipmentTypeId: 7, reason: "Maintenance", quantityUnavailable: 0 },
      })
    );
    expect(success).toHaveBeenCalledWith("Out-of-service entry cleared.");
  });

  it("confirms a nonzero quantity as saved", async () => {
    await saveOutOfService("Maintenance", "2");

    await waitFor(() => expect(success).toHaveBeenCalledWith("Out-of-service quantity saved."));
  });
});
