import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { equipmentSections } from "#/features/equipment-requests/components/equipment-sections";
import type { EquipmentLineProjection, EventProjection } from "#/features/events/access";
import type { EventPageData } from "#/features/events/page-data";

const {
  updateEquipmentArrangement,
  recordEquipmentUnavailable,
  completeEquipmentArrangements,
  checkEquipmentAvailability,
  reserveEquipment,
  releaseEquipment,
  checkLineAvailability,
  saveEquipmentLine,
  removeEquipmentLine,
  submitEquipmentRequest,
  invalidate,
  success,
} = vi.hoisted(() => ({
  updateEquipmentArrangement: vi.fn<() => Promise<unknown>>(),
  recordEquipmentUnavailable: vi.fn<() => Promise<unknown>>(),
  completeEquipmentArrangements: vi.fn<() => Promise<unknown>>(),
  checkEquipmentAvailability: vi.fn<() => Promise<unknown>>(),
  reserveEquipment: vi.fn<() => Promise<unknown>>(),
  releaseEquipment: vi.fn<() => Promise<unknown>>(),
  checkLineAvailability: vi.fn<() => Promise<unknown>>(),
  saveEquipmentLine: vi.fn<() => Promise<unknown>>(),
  removeEquipmentLine: vi.fn<() => Promise<unknown>>(),
  submitEquipmentRequest: vi.fn<() => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/equipment-requests/server-fns", () => ({
  updateEquipmentArrangement,
  recordEquipmentUnavailable,
  completeEquipmentArrangements,
  checkEquipmentAvailability,
  reserveEquipment,
  releaseEquipment,
  checkLineAvailability,
  saveEquipmentLine,
  removeEquipmentLine,
  submitEquipmentRequest,
}));
vi.mock("#/features/events/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success } }));

const lines: EquipmentLineProjection[] = [
  {
    id: "line-a",
    item: "Folding tables",
    quantity: 2,
    arrangementStatus: "reserved",
    notes: null,
    reservedQuantity: 2,
  },
  {
    id: "line-b",
    item: "PA system",
    quantity: 1,
    arrangementStatus: "reserved",
    notes: null,
    reservedQuantity: 1,
  },
];

function page(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]> = {},
  extra: Partial<Extract<EventPageData, { kind: "event" }>> = {}
): EventPageData {
  return {
    kind: "event",
    viewerId: "viewer-1",
    event: {
      access,
      event: {
        id: 1042,
        eventDate: "2026-11-04",
        startTime: "10:00",
        endTime: "16:00",
        status: "confirmed",
        ...event,
      },
    },
    ...extra,
  };
}

function renderSections(data: EventPageData) {
  const defs = equipmentSections(data);
  render(
    <>
      {defs.map(def => (
        <div key={def.id}>{def.render(data)}</div>
      ))}
    </>
  );
  return defs;
}

describe("equipment sections", () => {
  it("shows the organiser the read-only lines", () => {
    const defs = renderSections(page("organiser", { equipment: lines }));

    expect(defs.map(def => def.id)).toEqual(["equipment"]);
    expect(screen.getByRole("heading", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByText("Folding tables")).toBeTruthy();
    expect(screen.getAllByText("Reserved")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Reserve/ })).toBeNull();
  });

  it("gives the coordinator the equipment panel", () => {
    renderSections(
      page("coordinator", {
        status: "planning",
        equipment: lines,
        equipmentSubmittedAt: "2026-10-01T00:00:00.000Z",
      })
    );

    expect(screen.getByRole("heading", { name: "Equipment" })).toBeTruthy();
    expect(screen.getByText("Equipment requirements")).toBeTruthy();
    expect(screen.getByText("PA system")).toBeTruthy();
  });

  it("gives technical support the lines, the completion and the availability check", () => {
    const defs = renderSections(
      page(
        "technical_support",
        {
          name: "Community Hack Night",
          equipment: [
            {
              id: "line-a",
              item: "Power extension",
              quantity: 4,
              arrangementStatus: "requested",
              notes: null,
              arrangeable: true,
              assignedStaffName: null,
              reservedQuantity: null,
              lastRelease: null,
            },
          ],
          equipmentArrangementsCompletedAt: null,
        },
        {
          equipmentTypes: [
            { id: 1, name: "Power extension" },
            { id: 2, name: "Projector" },
          ],
        }
      )
    );

    expect(defs.map(def => def.id)).toEqual(["lines", "arrangements", "availability"]);
    expect(screen.getByRole("heading", { name: "Equipment lines" })).toBeTruthy();
    expect(screen.getByText("Power extension")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Technical arrangements" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark arrangements complete" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Check availability" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check availability" })).toBeTruthy();
  });

  it("shows technical support the completion once recorded", () => {
    renderSections(
      page("technical_support", {
        equipment: [],
        equipmentArrangementsCompletedAt: "2026-10-06T14:32:00.000Z",
      })
    );

    expect(screen.getByText("Technical arrangements complete.")).toBeTruthy();
  });
});
