import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EquipmentWorkListPage } from "#/features/equipment-requests/components/equipment-work-list-page";
import type { EventProjection } from "#/features/events/access";

// The work list links rather than calling back; the mock resolves the route params the way
// booking-request-queue.test.tsx does and passes className and aria-label through to the anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { eventId: number };
    className?: string;
    "aria-label"?: string;
  }) => (
    <a
      href={params ? to.replace("$eventId", String(params.eventId)) : to}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  ),
}));

const summit: EventProjection = {
  access: "technical_support",
  event: {
    id: 7,
    name: "Summit",
    eventDate: "2030-01-01",
    endDate: "2030-01-01",
    startTime: "09:00",
    endTime: "17:00",
    status: "approved",
    equipment: [
      {
        id: "line-a",
        item: "Projector",
        quantity: 2,
        arrangementStatus: "requested",
        notes: null,
      },
      {
        id: "line-b",
        item: "Microphone",
        quantity: 4,
        arrangementStatus: "reserved",
        notes: null,
      },
    ],
  },
};

const workshop: EventProjection = {
  access: "technical_support",
  event: {
    id: 9,
    name: "Workshop",
    eventDate: "2030-02-14",
    endDate: "2030-02-14",
    startTime: "13:30",
    endTime: "15:00",
    status: "planning",
    equipment: [
      { id: "line-c", item: "Speaker", quantity: 1, arrangementStatus: "requested", notes: null },
    ],
  },
};

describe("EquipmentWorkListPage (PTR-39 AC1)", () => {
  it("lists each submitted equipment request with its date and times and a link to open it", () => {
    render(<EquipmentWorkListPage events={[summit, workshop]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);

    const first = within(rows[0]);
    const link = first.getByRole("link", { name: "Open equipment request for Summit" });
    expect(link.getAttribute("href")).toBe("/equipment-requests/7");
    expect(first.getByText("1 Jan 2030")).toBeTruthy();
    expect(first.getByText("09:00–17:00")).toBeTruthy();
    expect(first.getByText("2 lines")).toBeTruthy();

    const second = within(rows[1]);
    expect(
      second.getByRole("link", { name: "Open equipment request for Workshop" }).getAttribute("href")
    ).toBe("/equipment-requests/9");
    expect(second.getByText("14 Feb 2030")).toBeTruthy();
    expect(second.getByText("13:30–15:00")).toBeTruthy();
    expect(second.getByText("1 line")).toBeTruthy();
  });

  it("says so when no equipment request has been submitted", () => {
    render(<EquipmentWorkListPage events={[]} />);

    expect(
      screen.getByText("No equipment requests have been submitted to Technical Support.")
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
