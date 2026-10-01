import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventWorkspace } from "#/features/events/components/event-workspace";
import type { EventProjection } from "#/features/events/access";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("#/features/equipment-requests/server-fns", () => ({
  reserveEquipment: vi.fn<() => Promise<unknown>>(),
  releaseEquipment: vi.fn<() => Promise<unknown>>(),
  checkLineAvailability: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn<(message: string) => void>() } }));

type Line = NonNullable<EventProjection["event"]["equipment"]>[number];

function workspace(line: Line) {
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
      equipment: [line],
    },
  };
  render(<EventWorkspace events={[summit]} />);
  return within(screen.getByRole("listitem"));
}

const projector: Line = {
  id: "line-a",
  item: "Projector",
  quantity: 2,
  arrangementStatus: "requested",
  notes: null,
  arrangeable: true,
};

describe("workspace equipment row actions (PTR-41, PTR-42)", () => {
  it("offers Reserve alone on a line holding nothing", () => {
    const row = workspace(projector);

    expect(row.getByRole("button", { name: "Reserve equipment for Projector" })).toBeTruthy();
    expect(
      row.queryByRole("button", { name: "Reduce or release equipment for Projector" })
    ).toBeNull();
  });

  it("offers Reduce or release beside Reserve once units are held", () => {
    const row = workspace({ ...projector, arrangementStatus: "reserved", reservedQuantity: 2 });

    expect(row.getByText("· 2 reserved")).toBeTruthy();
    expect(row.getByRole("button", { name: "Reserve equipment for Projector" })).toBeTruthy();
    expect(
      row.getByRole("button", { name: "Reduce or release equipment for Projector" })
    ).toBeTruthy();
  });

  it("offers neither on a line a colleague is arranging", () => {
    const row = workspace({ ...projector, reservedQuantity: 2, arrangeable: false });

    expect(row.queryByRole("button")).toBeNull();
  });

  it("shows the last release on the line", () => {
    const row = workspace({
      ...projector,
      reservedQuantity: 1,
      lastRelease: { quantity: 2, byName: "Sam Tech", at: "2026-10-01T09:00:00.000Z" },
    });

    expect(row.getByText(/Last release: 2 units given back by Sam Tech on/)).toBeTruthy();
  });
});
