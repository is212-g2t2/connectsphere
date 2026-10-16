// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockedArrangement, EventProjection } from "#/features/events/access";
import { BlockedArrangements } from "#/features/events/components/blocked-arrangements";
import { venueSections } from "#/features/events/components/venue-section";
import type { EventPageData } from "#/features/events/page-data";

const { releaseBlockedVenueBooking, invalidate, success } = vi.hoisted(() => ({
  releaseBlockedVenueBooking: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/venue-requests/server-fns", () => ({ releaseBlockedVenueBooking }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, error: vi.fn<(message: string) => void>() } }));

const booking: BlockedArrangement = {
  kind: "booking",
  id: "vr-1",
  venueName: "Harbour Hall",
  startsAt: "2030-12-01 18:00:00",
  endsAt: "2030-12-01 22:00:00",
  block: { reason: "Floor resurfacing", startsAt: "2030-12-01 00:00:00", endsAt: null },
};
const hold: BlockedArrangement = {
  kind: "hold",
  id: "hold-1",
  venueName: "Seminar Room 2A",
  startsAt: "2030-12-02 09:00:00",
  endsAt: "2030-12-02 12:00:00",
  block: {
    reason: "Rewiring",
    startsAt: "2030-12-02 08:00:00",
    endsAt: "2030-12-03 18:00:00",
  },
};

function pageData(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]>
): EventPageData {
  return {
    kind: "event",
    viewerId: "viewer-1",
    event: {
      access,
      event: {
        id: 1042,
        eventDate: "2030-12-01",
        startTime: "18:00",
        endTime: "22:00",
        status: "planning",
        expectedAttendance: 60,
        ...event,
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  invalidate.mockResolvedValue(undefined);
});

describe("the venue block flag on the Coordinator's event page (PTR-137 AC1, AC3, AC4)", () => {
  it("names each suspended booking and hold with the block's reason and period, and offers the replacement search", () => {
    render(<BlockedArrangements eventId={1042} arrangements={[booking, hold]} />);

    const region = screen.getByRole("region", { name: "Venue blocked" });
    // The steps come first, with the replacement search before the list of arrangements.
    const steps = within(region)
      .getAllByRole("listitem")
      .filter(item => item.closest("ol"));
    expect(steps.map(step => step.textContent?.slice(0, 16))).toEqual([
      "Find and request",
      "Once Venue Staff",
      "Confirm the even",
    ]);
    const items = within(region)
      .getAllByRole("listitem")
      .filter(item => item.closest("ul"));
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Booking suspended")).toBeTruthy();
    expect(within(items[0]).getByText("Harbour Hall, 1 Dec 2030, 18:00 – 22:00")).toBeTruthy();
    expect(within(items[0]).getByText("Floor resurfacing")).toBeTruthy();
    expect(within(items[0]).getByText("1 Dec 2030, 00:00 – until lifted")).toBeTruthy();
    expect(within(items[1]).getByText("Hold suspended")).toBeTruthy();
    expect(within(items[1]).getByText("2 Dec 2030, 08:00 – 3 Dec 2030, 18:00")).toBeTruthy();
    // Only a booking can be released; a hold is the Coordinator's own on the calendar.
    expect(
      within(items[0]).getByRole("button", {
        name: "Release this booking: Harbour Hall",
      })
    ).toBeTruthy();
    expect(within(items[1]).queryByRole("button", { name: /Release/ })).toBeNull();
    expect(
      within(region)
        .getByRole("link", { name: "Find a replacement venue" })
        .getAttribute("data-search")
    ).toBe(JSON.stringify({ eventId: 1042 }));
  });

  it("gives a hold-only block the waiting copy, without the release and confirm steps", () => {
    render(<BlockedArrangements eventId={1042} arrangements={[hold]} />);

    const region = screen.getByRole("region", { name: "Venue blocked" });
    // A suspended hold does not hold confirmation back, so the copy does not claim it does.
    expect(region.textContent).not.toContain("You cannot confirm");
    expect(region.textContent).not.toContain("release the suspended booking");
    expect(within(region).getByText(/Wait for Venue Staff to lift the block/)).toBeTruthy();
    expect(within(region).getByText("Block period")).toBeTruthy();
  });

  it("hides the replacement search when the event's status cannot take a request", () => {
    render(<BlockedArrangements eventId={1042} arrangements={[booking]} searchable={false} />);

    expect(screen.queryByRole("link", { name: "Find a replacement venue" })).toBeNull();
  });

  it("releases a suspended booking once the Coordinator confirms the dialog, and re-reads the page", async () => {
    releaseBlockedVenueBooking.mockResolvedValue({});
    const user = userEvent.setup();
    render(<BlockedArrangements eventId={1042} arrangements={[booking]} />);

    await user.click(screen.getByRole("button", { name: "Release this booking: Harbour Hall" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/will not come back when the block is lifted/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Release booking" }));

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        "Booking released. The Venue Staff who settled it will be notified."
      )
    );
    expect(releaseBlockedVenueBooking).toHaveBeenCalledWith({ data: { id: "vr-1" } });
    expect(invalidate).toHaveBeenCalled();
  });

  it("keeps the booking and shows the refusal when the server declines the release", async () => {
    releaseBlockedVenueBooking.mockRejectedValue(
      new Error("Only a booking suspended by a venue block can be released by its Coordinator.")
    );
    const user = userEvent.setup();
    render(<BlockedArrangements eventId={1042} arrangements={[booking]} />);

    await user.click(screen.getByRole("button", { name: "Release this booking: Harbour Hall" }));
    await user.click(screen.getByRole("button", { name: "Release booking" }));

    expect(
      await screen.findByText(
        "Only a booking suspended by a venue block can be released by its Coordinator."
      )
    ).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
  });

  it("shows the flag in the Coordinator's venue section and never in the Organiser's", () => {
    const coordinator = pageData("coordinator", { blockedArrangements: [booking] });
    const [section] = venueSections(coordinator);
    expect(section.visible(coordinator)).toBe(true);
    render(<>{section.render(coordinator)}</>);
    expect(screen.getByRole("region", { name: "Venue blocked" })).toBeTruthy();

    // The server projection never sends `blockedArrangements` to an Organiser (asserted in
    // tests/integration/venue-replanning.test.ts). Their section stays hidden and renders nothing.
    const organiser = pageData("organiser", { expectedAttendance: null });
    const [organiserSection] = venueSections(organiser);
    expect(organiserSection.visible(organiser)).toBe(false);
    const { container } = render(<>{organiserSection.render(organiser)}</>);
    expect(within(container).queryByRole("region", { name: "Venue blocked" })).toBeNull();
  });
});
