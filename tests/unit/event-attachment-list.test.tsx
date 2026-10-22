// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EVENT_ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";
import { EventAttachments } from "#/features/events/components/event-attachments";

const { listEventAttachments } = vi.hoisted(() => ({
  listEventAttachments: vi.fn<(options: { data: { id: number } }) => Promise<unknown>>(),
}));

vi.mock("#/features/events/server-fns", () => ({ listEventAttachments }));

const listed = {
  attachments: [
    {
      id: 7,
      originalFilename: "floor-plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
  ],
  storageAvailable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  listEventAttachments.mockResolvedValue(listed);
});

describe("EventAttachments", () => {
  it("lists the event's attachments with a download link for each", async () => {
    render(<EventAttachments eventId={41} />);

    expect(await screen.findByText("floor-plan.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    const download = await screen.findByRole("link", { name: "Download floor-plan.pdf" });
    expect(download.getAttribute("href")).toBe("/api/event-attachments?id=41&attachmentId=7");
    expect(download.getAttribute("download")).toBe("floor-plan.pdf");
    expect(listEventAttachments).toHaveBeenCalledExactlyOnceWith({ data: { id: 41 } });
  });

  it("reports an empty event without a download", async () => {
    listEventAttachments.mockResolvedValue({ attachments: [], storageAvailable: true });
    render(<EventAttachments eventId={41} />);

    expect(await screen.findByText("No supporting documents yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Download / })).toBeNull();
  });

  it("names unconfigured storage instead of offering a link that cannot work", async () => {
    listEventAttachments.mockResolvedValue({
      attachments: listed.attachments,
      storageAvailable: false,
    });
    render(<EventAttachments eventId={41} />);

    expect(await screen.findByText(EVENT_ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Download / })).toBeNull();
  });

  it("shows the server's reason and retries the list", async () => {
    const user = userEvent.setup();
    listEventAttachments
      .mockRejectedValueOnce(new Error("This attachment is no longer available."))
      .mockResolvedValue(listed);
    render(<EventAttachments eventId={41} />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This attachment is no longer available."
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("floor-plan.pdf")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
