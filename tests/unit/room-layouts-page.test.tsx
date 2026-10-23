// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoomLayoutsPage, layoutKeyForLabel } from "#/features/venues/components/room-layouts-page";
import type { SessionUser } from "#/features/auth/session";
import type { RoomLayout } from "#/features/venues/schema";

const { saveRoomLayout, deleteRoomLayout } = vi.hoisted(() => ({
  saveRoomLayout:
    vi.fn<(options: { data: { key: string; label: string } }) => Promise<RoomLayout>>(),
  deleteRoomLayout: vi.fn<(options: { data: { key: string } }) => Promise<unknown>>(),
}));

vi.mock("#/features/venues/server-fns", () => ({
  saveRoomLayout,
  deleteRoomLayout,
}));

const user = { role: "venue_staff" } as SessionUser;
const theatre: RoomLayout = { key: "theatre", label: "Theatre" };

describe("layoutKeyForLabel", () => {
  it.each([
    ["Cabaret", "cabaret"],
    ["Main Hall", "main-hall"],
    ["  U-Shape!! ", "u-shape"],
    ["Boardroom 12", "boardroom-12"],
  ])("maps the label %s to the key %s", (label, key) => {
    expect(layoutKeyForLabel(label)).toBe(key);
  });

  it("yields no key for a label with no letters or digits", () => {
    expect(layoutKeyForLabel("!!!")).toBe("");
    expect(layoutKeyForLabel("   ")).toBe("");
  });

  it("caps the key at the maintained maximum", () => {
    expect(layoutKeyForLabel("A".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("RoomLayoutsPage (PTR-161)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows only the label, with no key column", () => {
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    expect(screen.queryByText("Key", { exact: true })).toBeNull();
    expect(screen.getAllByText("Theatre").length).toBeGreaterThan(0);
  });

  it("adds a layout type from its label alone", async () => {
    const operator = userEvent.setup();
    saveRoomLayout.mockResolvedValue({ key: "cabaret", label: "Cabaret" });
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    fireEvent.change(screen.getByLabelText("Label", { exact: true }), {
      target: { value: "Cabaret" },
    });
    await operator.click(screen.getByRole("button", { name: "Add layout" }));

    await waitFor(() => {
      expect(saveRoomLayout).toHaveBeenCalledExactlyOnceWith({
        data: { key: "cabaret", label: "Cabaret" },
      });
    });
    expect(await screen.findByText('Layout type "Cabaret" added.')).toBeTruthy();
    expect(screen.getByLabelText("Label", { exact: true })).toHaveProperty("value", "");
  });

  it("refuses an add whose key exists under another label, without calling the server", async () => {
    const operator = userEvent.setup();
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    fireEvent.change(screen.getByLabelText("Label", { exact: true }), {
      target: { value: "Theatre!" },
    });
    await operator.click(screen.getByRole("button", { name: "Add layout" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "A layout with this key already exists. Rename the existing layout instead."
    );
    expect(saveRoomLayout).not.toHaveBeenCalled();
    expect(screen.getAllByText("Theatre").length).toBeGreaterThan(0);
  });

  it("treats an add that repeats the listed label as a no-op", async () => {
    const operator = userEvent.setup();
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    fireEvent.change(screen.getByLabelText("Label", { exact: true }), {
      target: { value: "Theatre" },
    });
    await operator.click(screen.getByRole("button", { name: "Add layout" }));

    expect(await screen.findByText('Layout type "Theatre" is already listed.')).toBeTruthy();
    expect(saveRoomLayout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a label that yields no key, without calling the server", async () => {
    const operator = userEvent.setup();
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    fireEvent.change(screen.getByLabelText("Label", { exact: true }), {
      target: { value: "!!!" },
    });
    await operator.click(screen.getByRole("button", { name: "Add layout" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(saveRoomLayout).not.toHaveBeenCalled();
  });

  it("disables the add control while the save runs", async () => {
    const operator = userEvent.setup();
    let resolveSave!: (layout: RoomLayout) => void;
    saveRoomLayout.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveSave = resolve;
        })
    );
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    fireEvent.change(screen.getByLabelText("Label", { exact: true }), {
      target: { value: "Cabaret" },
    });
    await operator.click(screen.getByRole("button", { name: "Add layout" }));

    expect(await screen.findByRole("button", { name: "Adding…" })).toHaveProperty("disabled", true);

    resolveSave({ key: "cabaret", label: "Cabaret" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add layout" })).toBeTruthy();
    });
  });

  it("renames a layout by its label and keeps its key", async () => {
    const operator = userEvent.setup();
    saveRoomLayout.mockResolvedValue({ key: "theatre", label: "Main Theatre" });
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    await operator.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const editor = screen.getAllByLabelText("New label for Theatre")[0];
    fireEvent.change(editor, { target: { value: "Main Theatre" } });
    await operator.click(
      within(editor.closest("tr, li") ?? document.body).getByRole("button", {
        name: "Save name",
      })
    );

    await waitFor(() => {
      expect(saveRoomLayout).toHaveBeenCalledExactlyOnceWith({
        data: { key: "theatre", label: "Main Theatre" },
      });
    });
    expect(await screen.findByText('Layout type renamed to "Main Theatre".')).toBeTruthy();
  });

  it("deletes only after the confirmation names the layout", async () => {
    const operator = userEvent.setup();
    deleteRoomLayout.mockResolvedValue({});
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    await operator.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('"Theatre"');
    expect(deleteRoomLayout).not.toHaveBeenCalled();

    await operator.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(deleteRoomLayout).not.toHaveBeenCalled();

    await operator.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const confirm = await screen.findByRole("alertdialog");
    await operator.click(within(confirm).getByRole("button", { name: "Delete layout" }));

    await waitFor(() => {
      expect(deleteRoomLayout).toHaveBeenCalledExactlyOnceWith({ data: { key: "theatre" } });
    });
    expect(await screen.findByText('Layout type "Theatre" deleted.')).toBeTruthy();
    expect(screen.queryByText("No layout types yet")).toBeTruthy();
  });

  it("keeps the row and names the venues when the server refuses the delete", async () => {
    const operator = userEvent.setup();
    deleteRoomLayout.mockRejectedValue(
      new Error('Cannot delete layout "Theatre" because these venues support it: Great Hall')
    );
    render(<RoomLayoutsPage user={user} initial={[theatre]} />);

    await operator.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("cannot be deleted");
    await operator.click(within(dialog).getByRole("button", { name: "Delete layout" }));

    const refusal = await within(dialog).findByRole("alert");
    expect(refusal.textContent).toContain("Great Hall");
    // The refused row stays listed, with no success notice.
    expect(screen.getAllByText("Theatre").length).toBeGreaterThan(0);
    expect(screen.queryByText('Layout type "Theatre" deleted.')).toBeNull();
  });

  it("shows the empty state when the list starts empty", () => {
    render(<RoomLayoutsPage user={user} initial={[]} />);

    expect(screen.getByText("No layout types yet")).toBeTruthy();
    expect(screen.getByText("Add the first layout type with the form above.")).toBeTruthy();
    expect(screen.getByLabelText("Label", { exact: true })).toBeTruthy();
  });
});
