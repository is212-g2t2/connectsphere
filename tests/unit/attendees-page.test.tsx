import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RegisteredAttendee } from "#/features/events/access";
import { AttendeesPage } from "#/features/events/components/attendees-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/dashboard">{children}</a>,
}));

function attendee(id: string, overrides: Partial<RegisteredAttendee> = {}): RegisteredAttendee {
  return {
    attendeeId: id,
    name: `Attendee ${id}`,
    email: `${id}@example.com`,
    vip: false,
    registeredAt: "2030-01-15T09:30:00.000Z",
    ...overrides,
  };
}

const attendees = [
  attendee("zoe", {
    name: "Zoe Hall",
    email: "zoe@example.com",
    registeredAt: "2030-03-01T09:00:00.000Z",
  }),
  attendee("amy", {
    name: "Amy Chen",
    email: "amy@example.com",
    registeredAt: "2030-01-02T09:00:00.000Z",
  }),
  attendee("max", {
    name: "Max Rao",
    email: "max@example.com",
    vip: true,
    registeredAt: "2030-02-01T09:00:00.000Z",
  }),
];

function renderPage(list: RegisteredAttendee[] = attendees) {
  return render(
    <AttendeesPage
      eventName="Harbour Summit"
      places={{ registered: 12, vip: 2, limit: 50, capacity: 50 }}
      attendees={list}
    />
  );
}

function rowFor(name: string) {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`Could not find the row for ${name}`);
  return within(row);
}

function bodyNames(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    row => (row as HTMLTableRowElement).cells.item(0)?.textContent ?? null
  );
}

describe("AttendeesPage", () => {
  it("renders the heading, the count line, and every row", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Harbour Summit" })).toBeDefined();
    expect(screen.getByText("12 / 50 registered (+2 VIP)")).toBeDefined();

    for (const person of attendees) {
      expect(screen.getByText(person.name)).toBeDefined();
      expect(screen.getByText(person.email)).toBeDefined();
    }
    expect(rowFor("Max Rao").getByText("VIP")).toBeDefined();
    expect(rowFor("Amy Chen").getByText("Standard")).toBeDefined();
    // The ISO timestamp renders as a reader-facing date, not the stored string.
    expect(rowFor("Amy Chen").getByText(/2030/)).toBeDefined();
  });

  it("searches names and emails", async () => {
    const actor = userEvent.setup();
    renderPage();
    const search = screen.getByRole("searchbox", { name: "Search attendees" });

    await actor.type(search, "amy");
    expect(screen.queryByText("Zoe Hall")).toBeNull();
    expect(screen.queryByText("Max Rao")).toBeNull();
    expect(screen.getByText("Amy Chen")).toBeDefined();

    await actor.clear(search);
    await actor.type(search, "max@example.com");
    expect(screen.queryByText("Amy Chen")).toBeNull();
    expect(screen.getByText("Max Rao")).toBeDefined();
  });

  it("sorts by a column when its header is clicked", async () => {
    const actor = userEvent.setup();
    const { container } = renderPage();
    expect(bodyNames(container)).toEqual(["Zoe Hall", "Amy Chen", "Max Rao"]);

    await actor.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyNames(container)).toEqual(["Amy Chen", "Max Rao", "Zoe Hall"]);

    await actor.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyNames(container)).toEqual(["Zoe Hall", "Max Rao", "Amy Chen"]);
  });

  it("filters by the VIP and standard types", async () => {
    const actor = userEvent.setup();
    const { container } = renderPage();

    await actor.click(screen.getByRole("button", { name: "VIP" }));
    expect(bodyNames(container)).toEqual(["Max Rao"]);

    await actor.click(screen.getByRole("button", { name: "Standard" }));
    expect(bodyNames(container)).toEqual(["Zoe Hall", "Amy Chen"]);

    await actor.click(screen.getByRole("button", { name: "All" }));
    expect(bodyNames(container)).toHaveLength(3);
  });

  it("shows the empty state when nothing matches", async () => {
    const actor = userEvent.setup();
    const { container } = renderPage();

    await actor.type(screen.getByRole("searchbox", { name: "Search attendees" }), "nobody here");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(screen.getByText("No attendees match this search.")).toBeDefined();
  });
});
