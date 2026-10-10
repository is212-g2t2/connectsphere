import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventProjection, RegisteredAttendee, VipAttendee } from "#/features/events/access";
import {
  hasRegistrationRecord,
  registrationsSections,
} from "#/features/events/components/registrations-section";
import type { EventPageData } from "#/features/events/page-data";

const {
  searchVipAttendees,
  addVipRegistration,
  removeVipRegistration,
  invalidate,
  success,
  failure,
} = vi.hoisted(() => ({
  searchVipAttendees: vi.fn<() => Promise<VipAttendee[]>>(),
  addVipRegistration: vi.fn<() => Promise<void>>(),
  removeVipRegistration: vi.fn<() => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  failure: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  searchVipAttendees,
  addVipRegistration,
  removeVipRegistration,
  confirmEvent: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("#/features/equipment-requests/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success, error: failure } }));

const attendees: RegisteredAttendee[] = [
  {
    attendeeId: "ava",
    name: "Ava Patel",
    email: "ava.patel@example.com",
    vip: true,
    registeredAt: "2026-10-01T10:20:00.000Z",
  },
  {
    attendeeId: "ben",
    name: "Ben Koh",
    email: "ben.koh@example.com",
    vip: false,
    registeredAt: "2026-10-01T11:05:00.000Z",
  },
];

function page(extra: Partial<Extract<EventPageData, { kind: "event" }>> = {}): EventPageData {
  const event: EventProjection = {
    access: "coordinator",
    event: {
      id: 1042,
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
      places: { registered: 38, vip: 4, limit: 60, capacity: 60 },
    },
  };
  return { kind: "event", event, viewerId: "viewer-1", attendees, ...extra };
}

function renderRegistrations(data: EventPageData) {
  const defs = registrationsSections(data);
  expect(defs).toHaveLength(1);
  render(<>{defs[0].render(data)}</>);
}

describe("hasRegistrationRecord", () => {
  it.each(["approved", "planning", "confirmed", "completed"] as const)("holds for %s", status => {
    expect(hasRegistrationRecord(status)).toBe(true);
  });

  it.each([
    "draft",
    "submitted",
    "under_review",
    "awaiting_organiser",
    "rejected",
    "cancelled",
  ] as const)("falls for %s", status => {
    expect(hasRegistrationRecord(status)).toBe(false);
  });
});

describe("registrations section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("shows one view: the places count, the table, and the Add VIP button — no second VIP list", () => {
    renderRegistrations(page());

    expect(screen.getByRole("heading", { name: "Registrations" })).toBeTruthy();
    expect(screen.getByText("38 / 60 registered (+4 VIP)")).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add VIP" })).toBeTruthy();
    expect(screen.queryByLabelText("VIP registrations")).toBeNull();
    expect(screen.queryByRole("button", { name: /^VIP registrations \(/ })).toBeNull();
    expect(screen.getByRole("cell", { name: "Ben Koh" })).toBeTruthy();
  });

  it("opens the add-VIP dialog from the button beside the filters", async () => {
    const user = userEvent.setup();
    renderRegistrations(page());

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add VIP" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("searchbox", { name: "Search attendees" })).toBeTruthy();
  });

  it("offers removal only on VIP rows", () => {
    renderRegistrations(page());

    expect(screen.getByRole("button", { name: "Remove VIP registration: Ava Patel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove VIP registration: Ben Koh" })).toBeNull();
  });

  it("filters the list by type", async () => {
    const user = userEvent.setup();
    renderRegistrations(page());

    await user.click(screen.getByRole("button", { name: "VIP" }));

    const table = screen.getByRole("table");
    expect(within(table).getByRole("cell", { name: "Ava Patel" })).toBeTruthy();
    expect(within(table).queryByRole("cell", { name: "Ben Koh" })).toBeNull();
  });

  it("searches the list by name", async () => {
    const user = userEvent.setup();
    renderRegistrations(page());

    await user.type(screen.getByRole("searchbox", { name: "Search attendees" }), "ben");

    const table = screen.getByRole("table");
    expect(within(table).queryByRole("cell", { name: "Ava Patel" })).toBeNull();
    expect(within(table).getByRole("cell", { name: "Ben Koh" })).toBeTruthy();
  });

  it("says so when nobody has registered", () => {
    renderRegistrations(page({ attendees: [] }));

    expect(screen.getByText("No attendees registered.")).toBeTruthy();
  });
});
