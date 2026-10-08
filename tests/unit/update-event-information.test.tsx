import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateEventInformation } from "#/features/coordination/components/update-event-information";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import type { OutstandingReleases } from "#/features/events/cancellation";

const { updateEventInformation, listEventArrangements, invalidate, success, info, warning, error } =
  vi.hoisted(() => ({
    updateEventInformation: vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<{
        changedFields: readonly string[];
        significantFields: readonly string[];
        notified: number;
      }>
    >(),
    listEventArrangements:
      vi.fn<(input: { data: { id: number } }) => Promise<OutstandingReleases>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  }));

vi.mock("#/features/events/server-fns", () => ({ updateEventInformation, listEventArrangements }));
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

/** The server's answer to an ordinary save: nothing significant, no one told. */
function saved(changedFields: readonly string[]) {
  return { changedFields, significantFields: [], notified: 0 };
}

const nothingHeld: OutstandingReleases = {
  venueBookings: [],
  venueHolds: [],
  equipmentReservations: [],
};

const held: OutstandingReleases = {
  venueBookings: [
    {
      id: "booking-1",
      venueName: "Harbour Hall",
      startsAt: "2030-12-01 18:00:00",
      endsAt: "2030-12-01 22:00:00",
    },
  ],
  venueHolds: [
    {
      id: "hold-1",
      venueId: 3,
      venueName: "Seminar Room 2A",
      startsAt: "2030-12-02 09:00:00",
      endsAt: "2030-12-02 12:00:00",
    },
  ],
  equipmentReservations: [{ id: "line-1", item: "Projector", quantity: 2 }],
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
    updateEventInformation.mockResolvedValue(saved(["eventName"]));
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
    updateEventInformation.mockResolvedValue(saved(["purpose"]));
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
    updateEventInformation.mockResolvedValue(saved(["purpose"]));
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
    updateEventInformation.mockResolvedValue(saved(["purpose"]));
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
    updateEventInformation.mockResolvedValue(saved([]));
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

describe("warning before a significant change (PTR-23)", () => {
  async function editAttendance() {
    const user = await openForm();
    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(attendance, "150");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    return user;
  }

  it("names every booking, hold and reservation the event holds, then saves with the acknowledgement (AC2, AC3)", async () => {
    listEventArrangements.mockResolvedValue(held);
    updateEventInformation.mockResolvedValue({
      changedFields: ["expectedAttendance"],
      significantFields: ["expectedAttendance"],
      notified: 2,
    });
    const user = await editAttendance();

    const dialog = await screen.findByRole("alertdialog");
    expect(listEventArrangements).toHaveBeenCalledWith({ data: { id: 7 } });
    expect(
      within(dialog).getByRole("heading", { name: "This is a significant change" })
    ).toBeTruthy();
    expect(within(dialog).getByText(/Changing the expected attendance affects/)).toBeTruthy();
    expect(within(dialog).getByText(/changes, cancels or re-statuses none/)).toBeTruthy();
    const items = within(dialog)
      .getAllByRole("listitem")
      .map(item => item.textContent);
    expect(items).toEqual([
      "Venue booking: Harbour Hall, 1 Dec 2030, 18:00 – 22:00",
      "Tentative hold: Seminar Room 2A, 2 Dec 2030, 09:00 – 12:00",
      "Equipment reservation: Projector × 2",
    ]);
    expect(within(dialog).getByText(/will be told what changed/)).toBeTruthy();
    // Nothing is sent while the warning waits.
    expect(updateEventInformation).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Event information saved. The staff holding its arrangements have been notified."
      )
    );
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { expectedAttendance: 150 }, acknowledgeSignificant: true },
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("says when the event holds nothing, and still asks before saving (AC3)", async () => {
    listEventArrangements.mockResolvedValue(nothingHeld);
    updateEventInformation.mockResolvedValue({
      changedFields: ["expectedAttendance"],
      significantFields: ["expectedAttendance"],
      notified: 0,
    });
    const user = await editAttendance();

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "This event holds no venue booking, tentative hold or equipment reservation."
      )
    ).toBeTruthy();
    expect(within(dialog).queryByRole("list")).toBeNull();
    expect(within(dialog).queryByText(/will be told/)).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(success).toHaveBeenCalledWith("Event information saved."));
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { expectedAttendance: 150 }, acknowledgeSignificant: true },
    });
  });

  it("returns to the form with its edits when the Coordinator goes back", async () => {
    listEventArrangements.mockResolvedValue(held);
    const user = await editAttendance();

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Go back" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(updateEventInformation).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>("Expected attendance (required)").value).toBe(
      "150"
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }).disabled).toBe(
      false
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel editing" }).disabled).toBe(
      false
    );
    expect(success).not.toHaveBeenCalled();
  });

  it("names every significant field of a mixed edit and sends the ordinary one with it", async () => {
    listEventArrangements.mockResolvedValue(nothingHeld);
    updateEventInformation.mockResolvedValue({
      changedFields: ["purpose", "proposedDates", "expectedAttendance"],
      significantFields: ["proposedDates", "expectedAttendance"],
      notified: 0,
    });
    const user = await openForm();
    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");
    fireEvent.change(screen.getByLabelText("Proposed end 1 (required)"), {
      target: { value: "2030-12-01T23:00" },
    });
    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(attendance, "150");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        /Changing the proposed dates and times and expected attendance affects/
      )
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));

    await waitFor(() => expect(updateEventInformation).toHaveBeenCalled());
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: {
        id: 7,
        amendments: {
          purpose: "Fundraiser dinner",
          proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T23:00" }],
          expectedAttendance: 150,
        },
        acknowledgeSignificant: true,
      },
    });
  });

  it("saves an ordinary edit with no warning and no read of the arrangements (AC4)", async () => {
    updateEventInformation.mockResolvedValue(saved(["purpose"]));
    const user = await openForm();

    await user.type(screen.getByLabelText("Purpose (required)"), " dinner");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(success).toHaveBeenCalledWith("Event information saved."));
    expect(listEventArrangements).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(updateEventInformation).toHaveBeenCalledWith({
      data: { id: 7, amendments: { purpose: "Fundraiser dinner" } },
    });
  });

  it("keeps the form open and shows the failure when the arrangements cannot be read", async () => {
    listEventArrangements.mockRejectedValue(new Error("Forbidden"));
    await editAttendance();

    expect(await screen.findByText("Forbidden")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(updateEventInformation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});
