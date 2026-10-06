import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import type { EventRequestStatus } from "#/features/event-requests/schema";

const { updateEventInformation, invalidate, success } = vi.hoisted(() => ({
  updateEventInformation:
    vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<{ changedFields: readonly string[] }>
    >(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
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
vi.mock("sonner", () => ({ toast: { success } }));

const actor = { id: "coord-a", email: "a@example.com", name: "Alex", role: "event_coordinator" };
const coordinators = [{ id: "coord-a", name: "Alex", email: "a@example.com" }];

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
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
};

function renderPage(request: Partial<CoordinationRequest> = {}) {
  return render(
    <CoordinationRequestPage
      request={{ ...approved, ...request }}
      coordinators={coordinators}
      user={actor}
    />
  );
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

describe("updating event information on the coordination page (PTR-22)", () => {
  it.each(["approved", "planning", "confirmed"] as const)(
    "offers the update to the assigned Coordinator of a %s event",
    status => {
      renderPage({ status });

      expect(screen.getByRole("heading", { name: "Update event information" })).toBeTruthy();
    }
  );

  it.each([
    "submitted",
    "under_review",
    "awaiting_organiser",
    "rejected",
    "completed",
    "cancelled",
  ] satisfies EventRequestStatus[])("does not offer the update of a %s event", status => {
    renderPage({ status });

    expect(screen.queryByRole("heading", { name: "Update event information" })).toBeNull();
  });

  it("does not offer the update to a Coordinator the event is not assigned to", () => {
    renderPage({ assignedCoordinatorId: "coord-b" });

    expect(screen.queryByRole("heading", { name: "Update event information" })).toBeNull();
  });

  it("opens the form on the recorded values and saves the change", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: ["eventName"] });
    const user = await openForm();

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
      data: expect.objectContaining({
        id: 7,
        eventName: "Annual Gala Dinner",
        purpose: "Fundraiser",
        expectedAttendance: 100,
        proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
      }),
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("says so when the save changed nothing", async () => {
    updateEventInformation.mockResolvedValue({ changedFields: [] });
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(success).toHaveBeenCalledWith("No changes to save."));
  });

  it("keeps the form open and shows the server's refusal", async () => {
    updateEventInformation.mockRejectedValue(
      new Error("This event's information cannot be updated while its status is completed.")
    );
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(
        "This event's information cannot be updated while its status is completed."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
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

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Event name (required)")).toBeNull();
    expect(updateEventInformation).not.toHaveBeenCalled();
  });
});
