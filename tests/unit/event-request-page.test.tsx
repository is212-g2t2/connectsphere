import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EventRequestsPage } from "#/features/event-requests/components/request-page";

const { saveEventRequestDraft } = vi.hoisted(() => ({
  saveEventRequestDraft:
    vi.fn<(options: { data: { eventName: string; id?: number } }) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("#/features/event-requests/server-fns", () => ({ saveEventRequestDraft }));

beforeEach(() => {
  vi.clearAllMocks();
});

function saveDraftNamed(name: string) {
  fireEvent.change(screen.getByLabelText("Event name (required)", { exact: true }), {
    target: { value: name },
  });
  return userEvent.setup().click(screen.getByRole("button", { name: "Save draft" }));
}

/** The id each call was sent with — `undefined` on a create, the row's id on an update. */
function sentIds() {
  return saveEventRequestDraft.mock.calls.map(([options]) => options.data.id);
}

/**
 * PTR-71 criterion 4. The page used to hold `draftId` in `useState` and set it from the resolved
 * row after every save; the id now travels as the action's own state, and these assertions are
 * what would catch a save that quietly opened a second draft beside the first.
 */
describe("EventRequestsPage", () => {
  it("creates a draft on the first save and updates that same draft on the next", async () => {
    saveEventRequestDraft.mockResolvedValue({ id: 41 });
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    await saveDraftNamed("Community workshop, revised");
    await waitFor(() => expect(saveEventRequestDraft).toHaveBeenCalledTimes(2));

    expect(sentIds()).toEqual([undefined, 41]);
  });

  it("keeps the confirmation off screen when a save is refused", async () => {
    saveEventRequestDraft.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");

    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    expect(screen.queryByText("Draft saved.")).toBeNull();
  });

  it("retries onto the same draft after a refusal rather than opening a second one", async () => {
    saveEventRequestDraft
      .mockResolvedValueOnce({ id: 41 })
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce({ id: 41 });
    render(<EventRequestsPage />);

    await saveDraftNamed("Community workshop");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    await saveDraftNamed("Community workshop, revised");
    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    // The refusal dropped the confirmation, so a failed save never reads as a saved one.
    expect(screen.queryByText("Draft saved.")).toBeNull();

    await saveDraftNamed("Community workshop, revised again");
    expect(await screen.findByText("Draft saved.")).toBeTruthy();

    // The id survived the refusal, so the retry updated the row rather than inserting beside it.
    expect(sentIds()).toEqual([undefined, 41, 41]);
  });
});
