import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChangeRequestApplyProvider } from "#/features/coordination/components/change-request-decisions";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import type { EventProjection } from "#/features/events/access";
import { eventInformationSections } from "#/features/events/components/event-information-section";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import type { EventPageData } from "#/features/events/page-data";

const { updateEventInformation, invalidate, success } = vi.hoisted(() => ({
  updateEventInformation: vi.fn<() => Promise<{ changedFields: readonly string[] }>>(),
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

const request = {
  id: 1042,
  organiserId: "org-1",
  eventName: "ConnectSphere Open Day",
  status: "confirmed",
  purpose: "Welcome new members.",
  proposedDates: [{ start: "2026-11-04T10:00", end: "2026-11-04T16:00" }],
  expectedAttendance: 60,
  description: "An open day for new members.",
  eventType: "Open day",
  venueRequirements: "Step-free access, PA system",
  roomLayoutPreference: "Mixed seating",
  accessibilityRequirements: "Step-free access throughout",
  equipmentRequirements: [{ type: "Folding tables", quantity: 2 }],
  specialArrangements: "None",
  registrationEnabled: true,
  registrationCapacity: 60,
  registrationOpensAt: "2026-09-01T00:00",
  registrationClosesAt: "2026-11-01T00:00",
  coordinator: { name: "Jonas Weber", email: "jonas@example.com" },
  clarifications: [],
  changeRequests: [],
  cancellationRequests: [],
  submittedAt: new Date("2026-09-20T00:00:00Z"),
  decidedAt: null,
} as unknown as EventRequestDetail;

const coordinationRequest = {
  ...request,
  assignedCoordinatorId: "coord-a",
  organiser: { name: "Maya Chen", email: "maya@example.com" },
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-16T00:00:00Z"),
} as unknown as CoordinationRequest;

function organiserPage(): EventPageData {
  const event: EventProjection = {
    access: "organiser",
    event: {
      id: 1042,
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
    },
  };
  return { kind: "event", viewerId: "viewer-1", event, organiserRequest: request };
}

function coordinatorPage(): EventPageData {
  const event: EventProjection = {
    access: "coordinator",
    event: {
      id: 1042,
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
    },
  };
  return {
    kind: "event",
    viewerId: "viewer-1",
    event,
    coordination: { request: coordinationRequest, coordinators: [] },
  };
}

describe("event information section", () => {
  it("shows the organiser the recorded details", () => {
    const data = organiserPage();
    const defs = eventInformationSections(data);
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe("Event information");
    render(<>{defs[0].render(data)}</>);

    expect(screen.getByRole("heading", { name: "Event information" })).toBeTruthy();
    // The coordinator contact lives in Requests & messages; it renders once.
    expect(screen.queryByText("Jonas Weber")).toBeNull();
    expect(screen.getByText("Welcome new members.")).toBeTruthy();
    expect(screen.getByText("Open day")).toBeTruthy();
    expect(screen.getByText("Folding tables × 2")).toBeTruthy();
    expect(screen.getByText(/Capacity 60/)).toBeTruthy();
  });

  it("gives the coordinator the update form", () => {
    const data = coordinatorPage();
    const defs = eventInformationSections(data);
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe("Update event information");
    // The event page holds the change-request apply this form shares with the decisions card.
    render(<ChangeRequestApplyProvider>{defs[0].render(data)}</ChangeRequestApplyProvider>);

    expect(screen.getByRole("heading", { name: "Update event information" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit event information" })).toBeTruthy();
  });

  it("stays hidden and renders nothing without its request", () => {
    const organiserBase = organiserPage();
    if (organiserBase.kind !== "event") throw new Error("fixture must be an event page");
    const withoutOrganiserRequest: EventPageData = { ...organiserBase, organiserRequest: null };
    const organiserDefs = eventInformationSections(withoutOrganiserRequest);
    expect(organiserDefs).toHaveLength(1);
    expect(organiserDefs[0].visible(withoutOrganiserRequest)).toBe(false);
    expect(organiserDefs[0].render(withoutOrganiserRequest)).toBeNull();

    const coordinatorBase = coordinatorPage();
    if (coordinatorBase.kind !== "event") throw new Error("fixture must be an event page");
    const withoutCoordination: EventPageData = { ...coordinatorBase, coordination: null };
    const coordinatorDefs = eventInformationSections(withoutCoordination);
    expect(coordinatorDefs).toHaveLength(1);
    expect(coordinatorDefs[0].visible(withoutCoordination)).toBe(false);
    expect(coordinatorDefs[0].render(withoutCoordination)).toBeNull();
  });
});
