import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventRequestsPage } from "#/features/event-requests/components/request-page";
import { SUBMITTED_EDIT_REFUSAL } from "#/features/event-requests/schema";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";

const { saveEventRequestDraft, submitEventRequest } = vi.hoisted(() => ({
  saveEventRequestDraft:
    vi.fn<(options: { data: { eventName: string; id?: number } }) => Promise<unknown>>(),
  submitEventRequest: vi.fn<(options: { data: { id: number } }) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  saveEventRequestDraft,
  submitEventRequest,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function saveDraftNamed(name: string) {
  fireEvent.change(screen.getByLabelText("Event name (required)", { exact: true }), {
    target: { value: name },
  });
  return userEvent.setup().click(screen.getByRole("button", { name: "Save draft" }));
}

function inputValue(label: string) {
  return screen.getByLabelText<HTMLInputElement | HTMLTextAreaElement>(label, { exact: true })
    .value;
}

/** The id each call was sent with — `undefined` on a create, the row's id on an update. */
function sentIds() {
  return saveEventRequestDraft.mock.calls.map(([options]) => options.data.id);
}

/**
 * PTR-71 criterion 4. The page used to hold `draftId` in `useState` and set it from the resolved
 * row after every save; the id now travels as the action's own state, and these assertions are
 * what would catch a save that quietly opened a second draft beside the first.
 */
describe("EventRequestsPage", () => {
  it("creates a draft on the first save and updates that same draft on the next", async () => {
    saveEventRequestDraft.mockResolvedValue({ id: 41 });
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    await saveDraftNamed("Community workshop, revised");
    await waitFor(() => expect(saveEventRequestDraft).toHaveBeenCalledTimes(2));

    expect(sentIds()).toEqual([undefined, 41]);
  });

  it("keeps the confirmation off screen when a save is refused", async () => {
    saveEventRequestDraft.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");

    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    expect(screen.queryByText("Draft saved.")).toBeNull();
  });

  it("retries onto the same draft after a refusal rather than opening a second one", async () => {
    saveEventRequestDraft
      .mockResolvedValueOnce({ id: 41 })
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce({ id: 41 });
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    await saveDraftNamed("Community workshop, revised");
    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    // The refusal dropped the confirmation, so a failed save never reads as a saved one.
    expect(screen.queryByText("Draft saved.")).toBeNull();

    await saveDraftNamed("Community workshop, revised again");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    // The id survived the refusal, so the retry updated the row rather than inserting beside it.
    expect(sentIds()).toEqual([undefined, 41, 41]);
  });
});

/**
 * Criterion 2: a draft loaded by the reopen route must be updated by the first save, not
 * duplicated — `useMutation`'s `previous` starts undefined here, so only `existingDraft`'s id can
 * carry the row across.
 */
const reopenedDraft = {
  id: 41,
  organiserId: "usr_1",
  status: "draft",
  submittedAt: null,
  assignedCoordinatorId: null,
  assignedAt: null,
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
  eventName: "Community workshop",
  purpose: "Plan the year with members",
  proposedDates: [{ start: "2030-11-18T09:30", end: "2030-11-18T12:45" }],
  expectedAttendance: 25,
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
  registrationEnabled: true,
  registrationCapacity: 25,
  registrationOpensAt: "2030-11-01T09:00",
  registrationClosesAt: "2030-11-08T17:00",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
} as EventRequestDraft;

describe("EventRequestsPage reopen (PTR-12)", () => {
  it("seeds the form with the loaded draft, converting stored values (AC2)", () => {
    render(<EventRequestsPage existingDraft={reopenedDraft} />);

    expect(inputValue("Proposed start 1 (required)")).toBe("2030-11-18T09:30");
    expect(inputValue("Proposed end 1 (required)")).toBe("2030-11-18T12:45");
    expect(inputValue("Expected attendance (required)")).toBe("25");
    expect(inputValue("Registration capacity (required)")).toBe("25");
    expect(inputValue("Registration opens (required)")).toBe("2030-11-01T09:00");
    expect(inputValue("Registration closes (required)")).toBe("2030-11-08T17:00");
    expect(
      screen
        .getByRole("checkbox", { name: "Require attendee registration" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("updates the loaded draft on and after the first save (AC2)", async () => {
    saveEventRequestDraft.mockResolvedValue({ id: 41 });
    render(<EventRequestsPage existingDraft={reopenedDraft} />);

    await saveDraftNamed("Community workshop, resumed");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    await saveDraftNamed("Community workshop, resumed again");
    await waitFor(() => expect(saveEventRequestDraft).toHaveBeenCalledTimes(2));

    expect(sentIds()).toEqual([41, 41]);
  });
});

function submitRequest() {
  return userEvent.setup().click(screen.getByRole("button", { name: "Submit request" }));
}

describe("EventRequestsPage submission (PTR-13)", () => {
  it("saves the draft, submits the row and confirms", async () => {
    saveEventRequestDraft.mockResolvedValue({ id: 41 });
    submitEventRequest.mockResolvedValue({ id: 41, status: "submitted" });
    render(<EventRequestsPage />);

    fireEvent.change(screen.getByLabelText("Event name (required)", { exact: true }), {
      target: { value: "Community workshop" },
    });
    await submitRequest();

    await waitFor(() =>
      expect(submitEventRequest).toHaveBeenCalledExactlyOnceWith({ data: { id: 41 } })
    );
    // The save opened the row; the submit carried the id it handed back, not a second draft.
    expect(sentIds()).toEqual([undefined]);
    expect(await screen.findByText("Request submitted.")).toBeTruthy();
    expect(screen.getByText(SUBMITTED_EDIT_REFUSAL)).toBeTruthy();
    // The form is gone with the confirmation, so there is nothing left to edit on this page.
    expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("names what the submission is missing when the server refuses it", async () => {
    saveEventRequestDraft.mockResolvedValue({ id: 41 });
    submitEventRequest.mockRejectedValue(
      new Error("This request is missing: Purpose, Expected attendance")
    );
    render(<EventRequestsPage />);

    await submitRequest();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This request is missing: Purpose, Expected attendance"
    );
    expect(screen.queryByText("Request submitted.")).toBeNull();
    // The refusal leaves the form standing, so the organiser can complete and submit again.
    expect(screen.getByRole("button", { name: "Submit request" })).toBeTruthy();
  });

  it("does not submit when the draft could not be saved", async () => {
    saveEventRequestDraft.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    render(<EventRequestsPage />);

    await submitRequest();

    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    expect(submitEventRequest).not.toHaveBeenCalled();
  });
});
