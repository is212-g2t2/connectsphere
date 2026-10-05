import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventProjection, VipAttendee } from "#/features/events/access";
import { EventWorkspace } from "#/features/events/components/event-workspace";
import { NAMED_REFUSALS, VipRegistrations } from "#/features/events/components/vip-registrations";
import { NOT_A_VIP_MESSAGE, venueCapacityReachedMessage } from "#/features/events/registration";

const { searchVipAttendees, addVipRegistration, removeVipRegistration, invalidate, success } =
  vi.hoisted(() => ({
    searchVipAttendees:
      vi.fn<(input: { data: { id: number; query: string } }) => Promise<VipAttendee[]>>(),
    addVipRegistration:
      vi.fn<(input: { data: { id: number; attendeeId: string } }) => Promise<VipAttendee>>(),
    removeVipRegistration:
      vi.fn<(input: { data: { id: number; attendeeId: string } }) => Promise<void>>(),
    invalidate: vi.fn<() => Promise<void>>(),
    success: vi.fn<(message: string) => void>(),
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
vi.mock("sonner", () => ({ toast: { success } }));

const ada: VipAttendee = { attendeeId: "ada", name: "Ada Lovelace", email: "ada@x.test" };
const alan: VipAttendee = { attendeeId: "alan", name: "Alan Turing", email: "alan@x.test" };

const card = (vipRegistrations: VipAttendee[] | null): EventProjection => ({
  access: "organiser",
  event: {
    id: 12,
    name: "Gala",
    eventDate: "2030-01-01",
    startTime: "09:00",
    endTime: "17:00",
    status: "confirmed",
    vipRegistrations,
  },
});

/** Types into the search box of an event with no VIPs yet. */
async function searchFor(text: string) {
  const user = userEvent.setup();
  render(<VipRegistrations eventId={12} vips={[]} />);
  await user.type(screen.getByRole("searchbox", { name: "Add a VIP" }), text);
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
  render(<VipRegistrations eventId={12} vips={[ada]} />);
  await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  return dialog;
}

describe("VipRegistrations (PTR-111)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidate.mockResolvedValue();
  });

  it("lists the VIPs and counts them apart (AC4)", () => {
    render(<VipRegistrations eventId={12} vips={[ada, alan]} />);

    expect(screen.getByText("2 VIPs")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map(row => within(row).getByText(/@x\.test$/).textContent)).toEqual([
      "ada@x.test",
      "alan@x.test",
    ]);
  });

  it("searches once the typing pauses, not on each keystroke", async () => {
    searchVipAttendees.mockResolvedValue([ada]);

    await searchFor("lovelace");

    expect(await screen.findByRole("button", { name: "Add Ada Lovelace as a VIP" })).toBeTruthy();
    expect(searchVipAttendees).toHaveBeenCalledOnce();
    expect(searchVipAttendees).toHaveBeenCalledWith({ data: { id: 12, query: "lovelace" } });
  });

  it("does not search for fewer than two characters", async () => {
    await searchFor(" a ");

    await new Promise(resolve => setTimeout(resolve, 400));
    expect(searchVipAttendees).not.toHaveBeenCalled();
  });

  it("says when no Attendee matches", async () => {
    searchVipAttendees.mockResolvedValue([]);

    await searchFor("zz");

    expect((await screen.findByRole("status")).textContent).toBe(
      "No Attendee without a registration matches “zz”."
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

    await user.type(screen.getByRole("searchbox", { name: "Add a VIP" }), "an");
    expect(await screen.findByRole("button", { name: "Add Alan Turing as a VIP" })).toBeTruthy();
    answerOlder?.([ada]);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "Add Ada Lovelace as a VIP" })).toBeNull();
  });

  it("adds the chosen Attendee, tells the caller, clears the search and reloads (AC1)", async () => {
    addVipRegistration.mockResolvedValue(ada);

    await addAda();

    await waitFor(() =>
      expect(addVipRegistration).toHaveBeenCalledWith({ data: { id: 12, attendeeId: "ada" } })
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Ada Lovelace is registered as a VIP.")
    );
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByRole("searchbox", { name: "Add a VIP" })).toHaveProperty("value", "");
    expect(screen.queryByRole("list", { name: "Matching Attendees" })).toBeNull();
  });

  it.each([...NAMED_REFUSALS, venueCapacityReachedMessage(4)])(
    "shows the refusal %o to an addition as the server words it, and reloads",
    async message => {
      addVipRegistration.mockRejectedValue(new Error(message));

      await addAda();

      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect(success).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalled();
    }
  );

  it("falls back to generic text for a failure that is not a named refusal", async () => {
    searchVipAttendees.mockRejectedValue(new Error("Forbidden"));

    await searchFor("ada");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not search the Attendees. Try again."
    );
  });

  it("removes a VIP once confirmed, tells the caller and reloads the event (AC6)", async () => {
    removeVipRegistration.mockResolvedValue();

    await removeAda();

    await waitFor(() =>
      expect(removeVipRegistration).toHaveBeenCalledWith({
        data: { id: 12, attendeeId: "ada" },
      })
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Ada Lovelace is no longer registered as a VIP.")
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("removes nothing when the removal is cancelled", async () => {
    const user = userEvent.setup();
    render(<VipRegistrations eventId={12} vips={[ada]} />);

    await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" })
    );

    expect(removeVipRegistration).not.toHaveBeenCalled();
  });

  it("shows a refused removal in the dialog and reloads, since someone else may have removed it", async () => {
    removeVipRegistration.mockRejectedValue(new Error(NOT_A_VIP_MESSAGE));

    const dialog = await removeAda();

    expect((await within(dialog).findByRole("alert")).textContent).toBe(NOT_A_VIP_MESSAGE);
    expect(invalidate).toHaveBeenCalled();
  });
});

describe("the workspace card's VIP section (PTR-111)", () => {
  it("shows the section on a published event", () => {
    render(<EventWorkspace events={[card([ada])]} />);

    expect(screen.getByRole("region", { name: "VIP registrations" })).toBeTruthy();
  });

  it("leaves it out when the event takes no VIPs", () => {
    render(<EventWorkspace events={[card(null)]} />);

    expect(screen.queryByRole("region", { name: "VIP registrations" })).toBeNull();
  });
});
