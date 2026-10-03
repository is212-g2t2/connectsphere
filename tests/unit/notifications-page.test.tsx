import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationsPage } from "#/features/notifications/components/notifications-page";
import { NotificationsPageSkeleton } from "#/features/notifications/components/notifications-page-skeleton";
import type { NotificationListItem } from "#/features/notifications/server-fns";

const linked: NotificationListItem = {
  id: 1,
  createdAt: "2030-11-01T01:00:00.000Z",
  summary: "Your booking request was approved.",
  href: "/venue-requests/request-001",
};

const neutral: NotificationListItem = {
  id: 2,
  createdAt: "2030-11-01T02:00:00.000Z",
  summary: null,
  href: null,
};

const summaryOnly: NotificationListItem = {
  id: 3,
  createdAt: "2030-11-01T03:00:00.000Z",
  summary: "Your venue request was settled.",
  href: null,
};

describe("NotificationsPage", () => {
  it("shows an empty-state message when no notifications are supplied", () => {
    render(<NotificationsPage notifications={[]} />);

    expect(screen.getByText("No notifications yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders a linked row with the summary text and the ISO instant on the timestamp", () => {
    render(<NotificationsPage notifications={[linked]} />);

    const link = screen.getByRole("link", { name: linked.summary as string });
    expect(link.getAttribute("href")).toBe(linked.href);
    // The actionable row is the only full-ink element: it must not be demoted like the dead rows.
    expect(link.className).not.toContain("text-muted-foreground");

    const time = screen.getByText("1 Nov 2030, 09:00");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe(linked.createdAt);
  });

  it("renders a neutral row muted with no link", () => {
    render(<NotificationsPage notifications={[neutral]} />);

    const text = screen.getByText("This notification is no longer available.");
    expect(text.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a summary-only row muted with no link", () => {
    render(<NotificationsPage notifications={[summaryOnly]} />);

    const text = screen.getByText(summaryOnly.summary as string);
    expect(text.tagName).toBe("P");
    expect(text.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("link")).toBeNull();
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
