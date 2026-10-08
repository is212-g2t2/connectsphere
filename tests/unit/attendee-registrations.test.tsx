import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendeeRegistrations } from "#/features/events/components/attendee-registrations";

const { listEventRegistrations } = vi.hoisted(() => ({
  listEventRegistrations:
    vi.fn<
      (input: {
        data: { id: number };
      }) => Promise<
        { attendeeId: string; name: string; email: string; vip: boolean; registeredAt: string }[]
      >
    >(),
}));

vi.mock("#/features/events/server-fns", () => ({
  listEventRegistrations,
}));

describe("AttendeeRegistrations", () => {
  test("renders button and fetches attendees on click", async () => {
    vi.mocked(listEventRegistrations).mockResolvedValueOnce([
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
    ]);

    render(<AttendeeRegistrations eventId={123} registeredCount={2} />);

    const user = userEvent.setup();
    const btn = screen.getByRole("button", { name: "View Attendees" });
    expect(btn).toBeTruthy();

    await user.click(btn);

    expect(screen.getByRole("heading", { name: /Attendees \(2\)/ })).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    expect(listEventRegistrations).toHaveBeenCalledWith({ data: { id: 123 } });

    expect(screen.getByText("VIP Attendees (1)")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Standard Attendees (1)")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
  });
});
