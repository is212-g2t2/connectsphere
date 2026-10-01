import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinationPage } from "#/features/coordination/components/coordination-page";
import type {
  AssignedEventRequest,
  PendingEventHandover,
} from "#/features/coordination/server-fns";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";

const { acceptEventHandover, declineEventHandover, invalidate, success } = vi.hoisted(() => ({
  acceptEventHandover: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  declineEventHandover: vi.fn<(input: { data: { id: number } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/coordination/server-fns", () => ({
  acceptEventHandover,
  declineEventHandover,
}));

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
  useRouter: () => ({
    navigate: vi.fn<() => void>(),
    invalidate,
  }),
}));

vi.mock("sonner", () => ({ toast: { success } }));

const waiting: UnassignedEventRequest = {
  id: 7,
  organiserId: "usr_org",
  status: "submitted",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedCoordinatorId: null,
  assignedAt: null,
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
  eventName: "Annual dinner",
  purpose: "Thank the volunteers",
  proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
  expectedAttendance: 120,
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
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-15T02:00:00Z"),
  organiser: { name: "Jane Doe", email: "jane.doe@example.com" },
};

const handover: PendingEventHandover = {
  id: 11,
  requestedAt: new Date("2026-09-25T02:00:00Z"),
  eventName: "Annual dinner",
  organiser: { name: "Jane Doe" },
  from: { name: "Alex" },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CoordinationPage (PTR-15 criterion 5)", () => {
  it("lists each unassigned request with its organiser, proposed date and submission time", () => {
    render(<CoordinationPage unassigned={[waiting]} assigned={[]} handovers={[]} />);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Annual dinner")).toBeTruthy();
    expect(within(row).getByText("Jane Doe")).toBeTruthy();
    expect(
      within(row).getByRole("link", { name: "jane.doe@example.com" }).getAttribute("href")
    ).toBe("mailto:jane.doe@example.com");
    expect(within(row).getByText("1 Dec 2030, 18:00")).toBeTruthy();
    // 02:00 UTC is 10:00 in Singapore, the fixed zone every instant renders in.
    expect(within(row).getByText("15 Sept 2026, 10:00").tagName).toBe("TIME");
  });

  it("says so when every submitted request already has a Coordinator", () => {
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[]} />);

    expect(screen.getByText("Every submitted request has a Coordinator.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the requests assigned to the signed-in Coordinator, and says so when there are none", () => {
    const assignedRow: AssignedEventRequest = {
      ...waiting,
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      handoverTo: null,
    };
    const { rerender } = render(
      <CoordinationPage unassigned={[]} assigned={[assignedRow]} handovers={[]} />
    );

    expect(screen.getByRole("link", { name: "Annual dinner" }).getAttribute("href")).toBe(
      "/coordination/7"
    );
    expect(screen.getByText("Jane Doe")).toBeTruthy();

    rerender(<CoordinationPage unassigned={[]} assigned={[]} handovers={[]} />);
    expect(screen.getByText("No requests are assigned to you.")).toBeTruthy();
  });

  it("shows the decided status next to an assigned request so it does not look actionable", () => {
    const decided: AssignedEventRequest = {
      ...waiting,
      status: "rejected",
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      handoverTo: null,
    };
    render(<CoordinationPage unassigned={[]} assigned={[decided]} handovers={[]} />);

    expect(screen.getByText("Rejected")).toBeTruthy();
  });

  it("notes a pending handover on the assigned list", () => {
    const assignedRow: AssignedEventRequest = {
      ...waiting,
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      handoverTo: "Bailey",
    };
    render(<CoordinationPage unassigned={[]} assigned={[assignedRow]} handovers={[]} />);

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Handover to Bailey pending")).toBeTruthy();
  });
});

describe("Handovers awaiting a response (PTR-110)", () => {
  it("lists the handover with who offered it, when, and the organiser", () => {
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[handover]} />);

    expect(screen.getByRole("heading", { name: "Handovers awaiting your response" })).toBeTruthy();
    expect(screen.getByText("Annual dinner")).toBeTruthy();
    expect(screen.getByText(/Alex offered this request to you/)).toBeTruthy();
    expect(screen.getByText(/25 Sept 2026, 10:00/)).toBeTruthy();
    expect(screen.getByText(/Organiser: Jane Doe/)).toBeTruthy();
  });

  it("accepts a handover and re-reads the page", async () => {
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[handover]} />);
    await userEvent.click(screen.getByRole("button", { name: /Accept handover/ }));

    await waitFor(() => expect(acceptEventHandover).toHaveBeenCalledWith({ data: { id: 11 } }));
    expect(declineEventHandover).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("Handover accepted.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("declines a handover and re-reads the page", async () => {
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[handover]} />);
    await userEvent.click(screen.getByRole("button", { name: /Decline handover/ }));

    await waitFor(() => expect(declineEventHandover).toHaveBeenCalledWith({ data: { id: 11 } }));
    expect(acceptEventHandover).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith("Handover declined.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows a refusal without pretending the handover was answered, and re-reads the list", async () => {
    acceptEventHandover.mockRejectedValue(new Error("This handover has already been answered."));
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[handover]} />);
    await userEvent.click(screen.getByRole("button", { name: /Accept handover/ }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This handover has already been answered."
    );
    expect(success).not.toHaveBeenCalled();
    // The offer is dead server-side; re-read so it does not stay actionable.
    expect(invalidate).toHaveBeenCalled();
  });

  it("labels the answer in flight with the event for assistive tech", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    acceptEventHandover.mockReturnValue(promise);
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[handover]} />);

    const accept = screen.getByRole("button", { name: "Accept handover for Annual dinner" });
    await userEvent.click(accept);
    expect(accept.textContent).toBe("Accepting…");
    expect(accept).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Decline handover/ })).toHaveProperty(
      "disabled",
      true
    );

    resolve({});
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("hides the section when no handover waits", () => {
    render(<CoordinationPage unassigned={[]} assigned={[]} handovers={[]} />);

    expect(screen.queryByRole("heading", { name: "Handovers awaiting your response" })).toBeNull();
  });
});
