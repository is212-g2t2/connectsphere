import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegisteredAttendee } from "#/features/events/access";
import { AttendeeRegistrations } from "#/features/events/components/attendee-registrations";

const { listEventRegistrations } = vi.hoisted(() => ({
  listEventRegistrations:
    vi.fn<(input: { data: { id: number } }) => Promise<RegisteredAttendee[]>>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  listEventRegistrations,
}));

const attendees: RegisteredAttendee[] = [
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttendeeRegistrations", () => {
  test("expands and fetches, showing the count and the VIP badge", async () => {
    vi.mocked(listEventRegistrations).mockResolvedValueOnce(attendees);

    render(<AttendeeRegistrations eventId={123} />);
    expect(listEventRegistrations).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attendees" }));

    expect(await screen.findByRole("button", { name: "Attendees (2)" })).toBeTruthy();
    expect(listEventRegistrations).toHaveBeenCalledWith({ data: { id: 123 } });

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("alice@example.com").className).toContain("break-all");
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("bob@example.com").className).toContain("break-all");
    expect(screen.getAllByText("VIP").length).toBe(1);
  });

  test("shows a loading state while fetching", async () => {
    let resolve!: (value: RegisteredAttendee[]) => void;
    const pending = new Promise<RegisteredAttendee[]>(r => {
      resolve = r;
    });
    vi.mocked(listEventRegistrations).mockReturnValueOnce(pending);

    render(<AttendeeRegistrations eventId={123} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attendees" }));

    expect(await screen.findByText("Loading…")).toBeTruthy();

    resolve([]);
    expect(await screen.findByText("No attendees registered.")).toBeTruthy();
  });

  test("shows the fixed error message when loading fails", async () => {
    vi.mocked(listEventRegistrations).mockRejectedValueOnce(new Error("boom-42-raw"));

    render(<AttendeeRegistrations eventId={123} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Attendees" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Could not load the attendee list. Reopen to try again."
    );
    expect(screen.queryByText("boom-42-raw")).toBeNull();
  });
});
