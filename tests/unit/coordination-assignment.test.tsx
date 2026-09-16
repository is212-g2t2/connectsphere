import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import { parseAssignmentInput } from "#/features/coordination/schema";
import type { AssignmentValues } from "#/features/coordination/schema";
import type { CoordinationRequest } from "#/features/coordination/server-fns";

const { assignEventRequest, navigate, success } = vi.hoisted(() => ({
  assignEventRequest: vi.fn<(input: { data: AssignmentValues }) => Promise<unknown>>(),
  navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));
vi.mock("#/features/coordination/server-fns", () => ({ assignEventRequest }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { requestId: string };
  }) => <a href={params ? to.replace("$requestId", params.requestId) : to}>{children}</a>,
  useNavigate: () => navigate,
}));
vi.mock("sonner", () => ({ toast: { success } }));

const actor = { id: "coord-a", email: "a@example.com", name: "Alex", role: "event_coordinator" };
const coordinators = [
  { ...actor, name: "Alex" },
  { id: "coord-b", name: "Bailey", email: "b@example.com" },
];
const request: CoordinationRequest = {
  id: 7,
  organiserId: "org",
  eventName: "Community workshop",
  status: "submitted",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedAt: null,
  assignedCoordinatorId: null,
  purpose: "Meet neighbours",
  proposedDates: [],
  expectedAttendance: 25,
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
  createdAt: new Date(),
  updatedAt: new Date(),
  organiser: { name: "Organiser", email: "org@example.com" },
  coordinator: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("assignment validation", () => {
  it("requires the observed assignment and a named Coordinator", () => {
    expect(() => parseAssignmentInput({ id: 7, coordinatorId: "coord-b" })).toThrow(
      /Invalid input/
    );
    expect(() =>
      parseAssignmentInput({ id: 7, coordinatorId: " ", expectedCoordinatorId: null })
    ).toThrow("Choose an Event Coordinator");
    expect(() =>
      parseAssignmentInput({ id: -1, coordinatorId: "coord-b", expectedCoordinatorId: null })
    ).toThrow("Choose an event request");
    expect(() =>
      parseAssignmentInput({
        id: 3_000_000_000,
        coordinatorId: "coord-b",
        expectedCoordinatorId: null,
      })
    ).toThrow("Choose an event request");
    expect(
      parseAssignmentInput({
        id: 7,
        coordinatorId: " coord-b ",
        expectedCoordinatorId: null,
        actorId: "spoofed",
      })
    ).toEqual({ id: 7, coordinatorId: "coord-b", expectedCoordinatorId: null });
  });
});

describe("Coordinator handover and pickup", () => {
  it("picks up an unassigned event as the signed-in Coordinator", async () => {
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: actor.id, expectedCoordinatorId: null },
      })
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/coordination" });
  });

  it("refuses an implicit submit with no Coordinator selected and never calls the server", async () => {
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    // The disabled button does not stop Enter in the focused select from submitting the form.
    const form = screen.getByRole("button", { name: "Assign to me" }).closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Choose an Event Coordinator");
    expect(assignEventRequest).not.toHaveBeenCalled();
  });

  it("hands an owned event to the selected Coordinator and leaves its detail", async () => {
    render(
      <CoordinationRequestPage
        request={{
          ...request,
          assignedCoordinatorId: actor.id,
          assignedAt: new Date(),
          coordinator: actor,
        }}
        coordinators={coordinators}
        user={actor}
      />
    );
    expect(screen.queryByRole("button", { name: "Assign to me" })).toBeNull();
    expect(screen.queryByRole("option", { name: /Alex/ })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Event Coordinator"), "coord-b");
    await userEvent.click(screen.getByRole("button", { name: "Reassign Coordinator" }));
    await waitFor(() =>
      expect(assignEventRequest).toHaveBeenCalledWith({
        data: { id: 7, coordinatorId: "coord-b", expectedCoordinatorId: actor.id },
      })
    );
    expect(navigate).toHaveBeenCalledWith({ to: "/coordination" });
    expect(success).toHaveBeenCalled();
  });

  it("shows a server refusal without claiming success or navigating away", async () => {
    assignEventRequest.mockResolvedValue(
      new Response("This assignment has changed.", { status: 409 })
    );
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This assignment has changed."
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("disables both assignment actions while a pickup is in flight", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    assignEventRequest.mockReturnValue(promise);
    render(<CoordinationRequestPage request={request} coordinators={coordinators} user={actor} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    expect(screen.getByRole("button", { name: "Assign to me" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Assigning…" })).toHaveProperty("disabled", true);
    resolve({});
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});
