import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationsPage } from "#/features/notifications/components/notifications-page";
import { NotificationsPageSkeleton } from "#/features/notifications/components/notifications-page-skeleton";
import type { NotificationListItem } from "#/features/notifications/server-fns";

const { markNotificationsRead, invalidate, toastError } = vi.hoisted(() => ({
  markNotificationsRead: vi.fn<(input: { data: unknown }) => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/notifications/server-fns", () => ({ markNotificationsRead }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

beforeEach(() => {
  markNotificationsRead.mockReset().mockResolvedValue(undefined);
  invalidate.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
});

const linked: NotificationListItem = {
  id: 1,
  createdAt: "2030-11-01T01:00:00.000Z",
  read: true,
  summary: "Your booking request was approved.",
  href: "/venue-requests/request-001",
};

const neutral: NotificationListItem = {
  id: 2,
  createdAt: "2030-11-01T02:00:00.000Z",
  read: true,
  summary: null,
  href: null,
};

const summaryOnly: NotificationListItem = {
  id: 3,
  createdAt: "2030-11-01T03:00:00.000Z",
  read: true,
  summary: "Your venue request was settled.",
  href: null,
};

describe("NotificationsPage", () => {
  it("shows an empty-state message when no notifications are supplied", () => {
    render(<NotificationsPage notifications={[]} unreadCount={0} />);

    expect(screen.getByText("No notifications yet.")).toBeTruthy();
    // Empty, the page already says there is nothing, so no count line repeats it.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders a linked row with the summary text and the ISO instant on the timestamp", () => {
    render(<NotificationsPage notifications={[linked]} unreadCount={0} />);

    const link = screen.getByRole("link", { name: linked.summary as string });
    expect(link.getAttribute("href")).toBe(linked.href);
    // The actionable row is the only full-ink element: it must not be demoted like the dead rows.
    expect(link.className).not.toContain("text-muted-foreground");

    const time = screen.getByText("1 Nov 2030, 09:00");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe(linked.createdAt);
  });

  it("renders a neutral row muted with no link", () => {
    render(<NotificationsPage notifications={[neutral]} unreadCount={0} />);

    const text = screen.getByText("This notification is no longer available.");
    expect(text.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a summary-only row muted with no link", () => {
    render(<NotificationsPage notifications={[summaryOnly]} unreadCount={0} />);

    const text = screen.getByText(summaryOnly.summary as string);
    expect(text.tagName).toBe("P");
    expect(text.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("NotificationsPage read state (PTR-56)", () => {
  const unread: NotificationListItem = {
    id: 9,
    createdAt: "2030-11-02T01:00:00.000Z",
    read: false,
    summary: "Event confirmed: Gala",
    href: "/event-requests/4",
  };
  const unreadNeutral: NotificationListItem = { ...neutral, id: 8, read: false };

  it("labels unread rows in text, shows the count as a status, and offers mark-all", () => {
    render(<NotificationsPage notifications={[unread, linked]} unreadCount={1} />);

    expect(screen.getByRole("status").textContent).toBe("1 unread");
    const [unreadRow, readRow] = screen.getAllByRole("listitem");
    expect(within(unreadRow).getByText("Unread")).toBeTruthy();
    expect(within(readRow).queryByText("Unread")).toBeNull();
    expect(within(readRow).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeTruthy();
  });

  it("shows the server's count rather than counting listed rows, so rows past the page still count", () => {
    render(<NotificationsPage notifications={[linked]} unreadCount={5} />);

    expect(screen.getByRole("status").textContent).toBe("5 unread");
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeTruthy();
  });

  it("says nothing is unread and hides mark-all when every row is read", () => {
    render(<NotificationsPage notifications={[linked]} unreadCount={0} />);

    expect(screen.getByRole("status").textContent).toBe("Nothing unread");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks one row read by id, naming the row and its time, and re-reads the list", async () => {
    render(<NotificationsPage notifications={[unread, unreadNeutral]} unreadCount={2} />);

    // A neutralised row's button names the neutral line, never the hidden subject.
    expect(
      screen.getByRole("button", {
        name: /^Mark as read, This notification is no longer available\., /,
      })
    ).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Mark as read, Event confirmed: Gala, 2 Nov 2030, 09:00",
    });
    await userEvent.click(button);

    expect(markNotificationsRead).toHaveBeenCalledWith({ data: { id: unread.id } });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    // Settled once the buttons re-enable; a success says nothing.
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("marks all read through the highest listed id, even when it is not the first row", async () => {
    // Listed second (an earlier instant) yet holding the higher id: the cutoff must still cover it.
    const olderHigherId: NotificationListItem = {
      ...unread,
      id: 12,
      createdAt: "2030-11-01T23:00:00.000Z",
    };
    render(
      <NotificationsPage notifications={[unread, olderHigherId, unreadNeutral]} unreadCount={3} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(markNotificationsRead).toHaveBeenCalledWith({ data: { throughId: 12 } });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("toasts the server's refusal when marking fails, and still re-reads the list", async () => {
    markNotificationsRead.mockRejectedValueOnce(new Error("Choose a notification"));
    render(<NotificationsPage notifications={[unread]} unreadCount={1} />);

    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Choose a notification"));
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("NotificationsPageSkeleton", () => {
  it("draws the page-width loading shell with the list-row placeholders", () => {
    const { container } = render(<NotificationsPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading your notifications…");

    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(3);
    expect(rows.item(0).children).toHaveLength(2);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
