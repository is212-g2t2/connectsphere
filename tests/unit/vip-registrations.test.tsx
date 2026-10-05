import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventProjection, VipRegistration } from "#/features/events/access";
import { EventWorkspace } from "#/features/events/components/event-workspace";
import { VipRegistrations } from "#/features/events/components/vip-registrations";
import {
  VIP_ALREADY_REMOVED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  venueCapacityReachedMessage,
} from "#/features/events/registration";
import { VIP_EMAIL_MESSAGE } from "#/features/events/schema";

const { addVipRegistration, removeVipRegistration, invalidate, success } = vi.hoisted(() => ({
  addVipRegistration:
    vi.fn<(input: { data: { id: number; email: string } }) => Promise<VipRegistration>>(),
  removeVipRegistration:
    vi.fn<(input: { data: { id: number; attendeeId: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({
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

const ada: VipRegistration = { attendeeId: "ada", name: "Ada Lovelace", email: "ada@x.test" };
const alan: VipRegistration = { attendeeId: "alan", name: "Alan Turing", email: "alan@x.test" };

async function addVip(email: string) {
  const user = userEvent.setup();
  render(<VipRegistrations eventId={12} vips={[]} />);
  await user.type(screen.getByLabelText("Attendee email"), email);
  await user.click(screen.getByRole("button", { name: "Add VIP" }));
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
    expect(
      screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" })
    ).toBeTruthy();
  });

  it("counts one VIP in the singular, and none without a list", () => {
    const { rerender } = render(<VipRegistrations eventId={12} vips={[ada]} />);
    expect(screen.getByText("1 VIP")).toBeTruthy();

    rerender(<VipRegistrations eventId={12} vips={[]} />);
    expect(screen.getByText("0 VIPs")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("adds an Attendee by email, tells the caller and reloads the event (AC1)", async () => {
    addVipRegistration.mockResolvedValue(ada);

    await addVip("ada@x.test");

    await waitFor(() =>
      expect(addVipRegistration).toHaveBeenCalledWith({ data: { id: 12, email: "ada@x.test" } })
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("Ada Lovelace is registered as a VIP.")
    );
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByLabelText("Attendee email")).toHaveProperty("value", "");
  });

  it("refuses an email that is not one before calling the server", async () => {
    await addVip("not-an-email");

    expect(await screen.findByText(VIP_EMAIL_MESSAGE)).toBeTruthy();
    expect(addVipRegistration).not.toHaveBeenCalled();
  });

  it.each([VIP_NOT_ATTENDEE_MESSAGE, venueCapacityReachedMessage(4)])(
    "shows the refusal %o as the server words it (AC3)",
    async message => {
      addVipRegistration.mockRejectedValue(new Error(message));

      await addVip("ada@x.test");

      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect(success).not.toHaveBeenCalled();
    }
  );

  it("falls back to generic text for a failure that is not a named refusal", async () => {
    addVipRegistration.mockRejectedValue(new Error("Forbidden"));

    await addVip("ada@x.test");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not add the VIP registration. Try again."
    );
  });

  it("removes a VIP, tells the caller and reloads the event (AC6)", async () => {
    removeVipRegistration.mockResolvedValue({});
    const user = userEvent.setup();
    render(<VipRegistrations eventId={12} vips={[ada]} />);

    await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));

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

  it("shows a refused removal and reloads, since someone else may have removed it", async () => {
    removeVipRegistration.mockRejectedValue(new Error(VIP_ALREADY_REMOVED_MESSAGE));
    const user = userEvent.setup();
    render(<VipRegistrations eventId={12} vips={[ada]} />);

    await user.click(screen.getByRole("button", { name: "Remove VIP registration: Ada Lovelace" }));

    expect((await screen.findByRole("alert")).textContent).toBe(VIP_ALREADY_REMOVED_MESSAGE);
    expect(invalidate).toHaveBeenCalled();
  });
});

const card = (vipRegistrations: VipRegistration[] | null): EventProjection => ({
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
