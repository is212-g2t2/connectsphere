import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateEventInformation } from "#/features/coordination/components/update-event-information";
import type { CoordinationRequest } from "#/features/coordination/server-fns";

const { updateEventInformation, invalidate, success, info, warning, error } = vi.hoisted(() => ({
  updateEventInformation:
    vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<{ changedFields: readonly string[] }>
    >(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({ updateEventInformation }));
vi.mock("#/features/coordination/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ navigate: vi.fn<() => void>(), invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, info, warning, error } }));

const approved: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Annual Gala",
  status: "approved",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: new Date("2026-09-15T03:00:00Z"),
  assignedCoordinatorId: "coord-a",
  decisionReason: null,
  decidedByCoordinatorId: "coord-a",
  decidedByCoordinatorName: "Alex",
  decidedAt: new Date("2026-09-16T02:00:00Z"),
  confirmedById: null,
  confirmedByName: null,
  confirmedAt: null,
  completedById: null,
  completedByName: null,
  completedAt: null,
  cancelledById: null,
  cancelledByName: null,
  cancelledAt: null,
  purpose: "Fundraiser",
  proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
  expectedAttendance: 100,
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
  registrationEnabled: false,
  registrationCapacity: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-16T02:00:00Z"),
  organiser: { name: "Organiser", email: "org@example.com" },
  coordinator: { name: "Alex", email: "a@example.com" },
  clarifications: [],
  changeRequests: [],
  cancellationRequests: [],
  outstandingReleases: null,
  pendingHandover: null,
  venueRequest: null,
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
};

function renderPage(request: Partial<CoordinationRequest> = {}) {
  return render(<UpdateEventInformation request={{ ...approved, ...request }} />);
}

async function openForm() {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "Edit event information" }));
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updating event information (PTR-22)", () => {
  it("opens the form on the recorded values and sends only the changed field", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["eventName"] });
    const user = await openForm();
    const toggle = screen.getByRole("button", { name: "Cancel editing" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const name = screen.getByLabelText<HTMLInputElement>("Event name (required)");
    expect(name.value).toBe("Annual Gala");
    expect(screen.getByLabelText<HTMLInputElement>("Expected attendance (required)").value).toBe(
      "100"
    );
    await user.clear(name);
    await user.type(name, "Annual Gala Dinner");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(success).toHaveBeenCalledWith("Event information saved."));
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { eventName: "Annual Gala Dinner" } },
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    // Focus returns to the toggle, so a keyboard user keeps their place.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit event information" })
    );
  });

  it("re-reads the page before it closes the form, and holds the toggle until then", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["purpose"] });
    const reload = Promise.withResolvers<void>();
    invalidate.mockReturnValue(reload.promise);
    const user = await openForm();

    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(screen.getByLabelText("Purpose (required)")).toBeTruthy();
    // A form reopened now would be closed by this save, so the toggle waits.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel editing" }).disabled).toBe(
      true
    );
    reload.resolve();
    await waitFor(() => expect(screen.queryByLabelText("Purpose (required)")).toBeNull());
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Edit event information" }).disabled
    ).toBe(false);
  });

  it("sends only the touched field after the page re-reads underneath the open form", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["purpose"] });
    const user = userEvent.setup();
    const { rerender } = renderPage({
      equipmentRequirements: [{ type: "Projector", quantity: 1 }],
    });
    await user.click(screen.getByRole("button", { name: "Edit event information" }));

    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");
    // Another panel's action re-reads the page: a new copy of the record, a new name from a
    // second tab, and the same dates and equipment.
    rerender(
      <UpdateEventInformation
        request={{
          ...approved,
          eventName: "Annual Gala Dinner",
          proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
          equipmentRequirements: [{ type: "Projector", quantity: 1 }],
        }}
      />
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateEventInformation).toHaveBeenCalled());
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { purpose: "Fundraiser dinner" } },
    });
  });

  it("says the change was saved when only the re-read fails", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["purpose"] });
    invalidate.mockRejectedValue(new Error("offline"));
    const user = await openForm();

    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith("The change was saved. Refresh this page to see it.")
    );
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Purpose (required)")).toBeNull();
  });

  it("says so when the save changed nothing", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: [] });
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(info).toHaveBeenCalledWith("No changes to save."));
    expect(updateEventInformation).toHaveBeenCalledWith({ data: { id: 7, amendments: {} } });
    expect(invalidate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("keeps the form open and shows the server's refusal", async () => {
    updateEventInformation.mockRejectedValue(
      new Error("This event's information cannot be updated while its status is completed.")
    );
    const reload = Promise.withResolvers<void>();
    invalidate.mockReturnValue(reload.promise);
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The toast lands at once; the inline message waits for the re-read the toggle is waiting on.
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "This event's information cannot be updated while its status is completed."
      )
    );
    expect(invalidate).toHaveBeenCalled();
    // A reopened form would sit on stale props, so the toggle waits for the re-read.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel editing" }).disabled).toBe(
      true
    );

    reload.resolve();

    expect(
      await screen.findByText(
        "This event's information cannot be updated while its status is completed."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Cancel editing" }).disabled
      ).toBe(false)
    );
  });

  it("refuses a cleared required field at its control without calling the server", async () => {
    const user = await openForm();

    await user.clear(screen.getByLabelText("Expected attendance (required)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Expected attendance is required")).toBeTruthy();
    expect(updateEventInformation).not.toHaveBeenCalled();
  });

  it("closes the form without saving on cancel", async () => {
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(screen.queryByLabelText("Event name (required)")).toBeNull();
    expect(updateEventInformation).not.toHaveBeenCalled();
  });

  it("confirms before discarding edits on cancel", async () => {
    const user = await openForm();

    await user.type(screen.getByLabelText("Event name (required)"), " Dinner");
    await user.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Discard unsaved changes?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const name = screen.getByLabelText<HTMLInputElement>("Event name (required)");
    expect(name).toBeTruthy();
    expect(name.value).toBe("Annual Gala Dinner");
    await user.click(screen.getByRole("button", { name: "Cancel editing" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.queryByLabelText("Event name (required)")).toBeNull());
    expect(updateEventInformation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit event information" })
    );
  });
});
