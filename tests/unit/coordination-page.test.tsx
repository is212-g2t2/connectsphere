import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoordinationPage } from "#/features/coordination/components/coordination-page";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const waiting: UnassignedEventRequest = {
  id: 7,
  organiserId: "usr_org",
  status: "submitted",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedCoordinatorId: null,
  assignedAt: null,
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
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-15T02:00:00Z"),
  organiser: { name: "Jane Doe", email: "jane.doe@example.com" },
};

describe("CoordinationPage (PTR-15 criterion 5)", () => {
  it("lists each unassigned request with its organiser, proposed date and submission time", () => {
    render(<CoordinationPage unassigned={[waiting]} />);

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
    render(<CoordinationPage unassigned={[]} />);

    expect(screen.getByText("Every submitted request has a Coordinator.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
