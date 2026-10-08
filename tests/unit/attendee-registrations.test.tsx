import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendeeRegistrations } from "#/features/events/components/attendee-registrations";
import type { EventRegistrationRow } from "#/features/events/server-fns";

const { listEventRegistrations } = vi.hoisted(() => ({
  listEventRegistrations:
    vi.fn<(input: { data: { id: number } }) => Promise<EventRegistrationRow[]>>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  listEventRegistrations,
}));

const ROWS: EventRegistrationRow[] = [
  {
    attendeeId: "1",
    name: "Alice",
    email: "alice@example.com",
    vip: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
  },
  {
    attendeeId: "2",
    name: "Bob",
    email: "bob@example.com",
    vip: true,
    registeredAt: "2026-01-02T00:00:00.000Z",
  },
];

describe("AttendeeRegistrations", () => {
  beforeEach(() => {
    vi.mocked(listEventRegistrations).mockReset();
  });

  test("reads the attendees when the dialog opens, not before", async () => {
    vi.mocked(listEventRegistrations).mockResolvedValueOnce(ROWS);

    render(<AttendeeRegistrations eventId={123} registeredCount={2} />);

    // The list is read on the interaction that needs it, not from an effect on mount.
    expect(listEventRegistrations).not.toHaveBeenCalled();

    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: "View attendees" });
    await user.click(btn);

    expect(screen.getByRole("heading", { name: "Attendees (2)" })).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText("Loading…")).toBeNull();
    });

    expect(listEventRegistrations).toHaveBeenCalledWith({ data: { id: 123 } });
    expect(screen.getByText("VIP attendees (1)")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Standard attendees (1)")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });

  test("words a named refusal itself and keeps any other fault generic", async () => {
    vi.mocked(listEventRegistrations)
      .mockRejectedValueOnce(new Error("Forbidden"))
      .mockRejectedValueOnce(new Error("internal detail: connection refused"));

    render(<AttendeeRegistrations eventId={123} registeredCount={2} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View attendees" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toBe("You do not have permission to view these Attendees.");

    // Reopening reads again; an unnamed fault never shows its raw message.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "View attendees" }));

    const generic = await screen.findByRole("alert");
    expect(generic.textContent).toBe("Could not load the Attendees. Try again.");
    expect(generic.textContent).not.toContain("connection refused");
  });
});
