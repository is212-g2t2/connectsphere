import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VipAttendee } from "#/features/events/access";
import { AddVipDialog, RemoveVipButton } from "#/features/events/components/vip-registrations";
import { VIP_SEARCH_MESSAGE } from "#/features/events/schema";
import {
  NOT_A_VIP_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  venueCapacityReachedMessage,
} from "#/features/events/registration";

const {
  searchVipAttendees,
  addVipRegistration,
  removeVipRegistration,
  invalidate,
  success,
  failure,
} = vi.hoisted(() => ({
  searchVipAttendees:
    vi.fn<(input: { data: { id: number; query: string } }) => Promise<VipAttendee[]>>(),
  addVipRegistration:
    vi.fn<(input: { data: { id: number; attendeeId: string } }) => Promise<void>>(),
  removeVipRegistration:
    vi.fn<(input: { data: { id: number; attendeeId: string } }) => Promise<void>>(),
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

const ada: VipAttendee = { attendeeId: "ada", name: "Ada Lovelace", email: "ada@x.test" };
const alan: VipAttendee = { attendeeId: "alan", name: "Alan Turing", email: "alan@x.test" };

/** Opens the "Add VIP" dialog, which holds the search form. */
async function openAddDialog(user: { click: (element: Element) => Promise<void> }) {
  await user.click(screen.getByRole("button", { name: "Add VIP" }));
}

/** Types into the search box of the add dialog. */
async function searchFor(text: string) {
  const user = userEvent.setup();
  render(<AddVipDialog eventId={12} />);
  await openAddDialog(user);
  await user.type(searchbox(), text);
  return user;
}

/** Searches for Ada and adds her from the results. */
async function addAda() {
  searchVipAttendees.mockResolvedValue([ada]);
  const user = await searchFor("ada");
  await user.click(await screen.findByRole("button", { name: "Add Ada Lovelace as a VIP" }));
}

/** Opens Ada's removal dialog and confirms it. */
async function removeAda() {
  const user = userEvent.setup();
  render(<RemoveVipButton eventId={12} vip={ada} />);
  await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  return dialog;
}

const searchbox = () => screen.getByRole("searchbox", { name: "Search attendees" });

describe("AddVipDialog (PTR-111)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("keeps the search form in an Add VIP dialog", async () => {
    const user = userEvent.setup();
    render(<AddVipDialog eventId={12} />);

    expect(screen.queryByRole("searchbox", { name: "Search attendees" })).toBeNull();
    await openAddDialog(user);
    expect(screen.getByRole("searchbox", { name: "Search attendees" })).toBeTruthy();
  });

  it("searches once the typing pauses, not on each keystroke, and says how many match", async () => {
    searchVipAttendees.mockResolvedValue([ada]);

    await searchFor("lovelace");

    expect(await screen.findByRole("button", { name: "Add Ada Lovelace as a VIP" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1 Attendee matches.");
    expect(searchVipAttendees).toHaveBeenCalledOnce();
    expect(searchVipAttendees).toHaveBeenCalledWith({ data: { id: 12, query: "lovelace" } });
  });

  it("does not search for fewer than two characters", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AddVipDialog eventId={12} />);
      await openAddDialog(user);

      await user.type(searchbox(), " a ");
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(searchVipAttendees).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches at once on Enter, and does not search the same query again once the typing pauses", async () => {
    searchVipAttendees.mockResolvedValue([ada]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AddVipDialog eventId={12} />);
      await openAddDialog(user);

      await user.type(searchbox(), "ada{Enter}");
      expect(await screen.findByRole("button", { name: "Add Ada Lovelace as a VIP" })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(searchVipAttendees).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses Enter on a query too short to search, in the schema's words, until it is longer", async () => {
    searchVipAttendees.mockResolvedValue([ada]);

    const user = await searchFor("a{Enter}");

    expect(await screen.findByText(VIP_SEARCH_MESSAGE)).toBeTruthy();
    expect(searchVipAttendees).not.toHaveBeenCalled();

    await user.type(searchbox(), "da");
    await waitFor(() => expect(screen.queryByText(VIP_SEARCH_MESSAGE)).toBeNull());
    await waitFor(() =>
      expect(searchVipAttendees).toHaveBeenCalledWith({ data: { id: 12, query: "ada" } })
    );
  });

  it("says when no Attendee matches", async () => {
    searchVipAttendees.mockResolvedValue([]);

    await searchFor("zz");

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "No Attendee without a registration matches “zz”."
      )
    );
  });

  it("says when only the first matches are shown", async () => {
    searchVipAttendees.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ ...ada, attendeeId: `ada-${index}` }))
    );

    await searchFor("ada");

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "10 or more Attendees match. Type more to narrow the search."
      )
    );
  });

  it("shows only the answer to the latest query", async () => {
    let answerOlder: ((attendees: VipAttendee[]) => void) | undefined;
    searchVipAttendees.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answerOlder = resolve;
        })
    );
    searchVipAttendees.mockResolvedValueOnce([alan]);
    const user = await searchFor("al");
    await waitFor(() => expect(searchVipAttendees).toHaveBeenCalledOnce());

    await user.type(searchbox(), "an");
    expect(await screen.findByRole("button", { name: "Add Alan Turing as a VIP" })).toBeTruthy();
    await act(async () => {
      answerOlder?.([ada]);
    });

    expect(screen.queryByRole("button", { name: "Add Ada Lovelace as a VIP" })).toBeNull();
  });

  it("adds the chosen Attendee, clears the search, returns focus to it and reloads (AC1)", async () => {
    addVipRegistration.mockResolvedValue();

    await addAda();

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Ada Lovelace is registered as a VIP.")
    );
    expect(addVipRegistration).toHaveBeenCalledWith({ data: { id: 12, attendeeId: "ada" } });
    expect(invalidate).toHaveBeenCalled();
    await waitFor(() => expect(searchbox()).toHaveProperty("value", ""));
    expect(screen.queryByRole("list", { name: "Matching Attendees" })).toBeNull();
    expect(document.activeElement).toBe(searchbox());
  });

  it("keeps a newer search when an addition ends after the user typed on", async () => {
    let finish: (() => void) | undefined;
    addVipRegistration.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );

    await addAda();
    await userEvent.setup().type(searchbox(), " l");
    await act(async () => {
      finish?.();
    });

    await waitFor(() => expect(success).toHaveBeenCalled());
    expect(searchbox()).toHaveProperty("value", "ada l");
  });

  it("shows which addition is running", async () => {
    // Settled before the test ends: React holds later transitions behind one still running.
    let finish: (() => void) | undefined;
    addVipRegistration.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );

    await addAda();

    expect(await screen.findByRole("button", { name: "Add Ada Lovelace as a VIP" })).toHaveProperty(
      "textContent",
      "Adding…"
    );
    await act(async () => {
      finish?.();
    });
  });

  it.each([
    VIP_NOT_ATTENDEE_MESSAGE,
    VIP_ALREADY_REGISTERED_MESSAGE,
    VIPS_CLOSED_MESSAGE,
    REGISTRATION_NOT_OPEN_MESSAGE,
    venueCapacityReachedMessage(4),
  ])(
    "shows the refusal %o beside the Attendee, as the server words it, and reloads",
    async message => {
      addVipRegistration.mockRejectedValue(new Error(message));

      await addAda();

      const row = screen.getByRole("button", { name: "Add Ada Lovelace as a VIP" }).closest("li");
      expect((await within(row as HTMLElement).findByRole("alert")).textContent).toBe(message);
      expect(success).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalled();
    }
  );

  it("falls back to generic text for a failure that is not a named refusal, and reloads", async () => {
    // What a Coordinator gets once the event is handed to someone else.
    searchVipAttendees.mockRejectedValue(new Error("Forbidden"));

    await searchFor("ada");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not search the Attendees. Try again."
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("shows a named search refusal as the server words it, and reloads", async () => {
    searchVipAttendees.mockRejectedValue(new Error(VIPS_CLOSED_MESSAGE));

    await searchFor("ada");

    expect((await screen.findByRole("alert")).textContent).toBe(VIPS_CLOSED_MESSAGE);
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("RemoveVipButton (PTR-111)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("renders an icon-only bin button", () => {
    render(<RemoveVipButton eventId={12} vip={ada} />);

    const remove = screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" });
    expect(remove.querySelector("svg")).toBeTruthy();
  });

  it("removes a VIP once confirmed, tells the caller and reloads the event (AC6)", async () => {
    removeVipRegistration.mockResolvedValue();

    await removeAda();

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Ada Lovelace is no longer registered as a VIP.")
    );
    expect(removeVipRegistration).toHaveBeenCalledWith({ data: { id: 12, attendeeId: "ada" } });
    expect(invalidate).toHaveBeenCalled();
  });

  it("removes nothing when the removal is cancelled", async () => {
    const user = userEvent.setup();
    render(<RemoveVipButton eventId={12} vip={ada} />);

    await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" })
    );

    expect(removeVipRegistration).not.toHaveBeenCalled();
  });

  it.each([NOT_A_VIP_MESSAGE, VIPS_CLOSED_MESSAGE])(
    "tells a refused removal %o in a toast, which outlives the row the reload takes away",
    async message => {
      removeVipRegistration.mockRejectedValue(new Error(message));

      await removeAda();

      await waitFor(() => expect(failure).toHaveBeenCalledWith(message));
      expect(invalidate).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    }
  );

  it("keeps the dialog open with generic text for a failure that is not a named refusal", async () => {
    removeVipRegistration.mockRejectedValue(new Error("Network down"));

    const dialog = await removeAda();

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Could not remove this VIP registration. Try again."
    );
    expect(failure).not.toHaveBeenCalled();
  });
});
