import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventPageData } from "#/features/events/page-data";
import { venueRequestSections } from "#/features/venue-requests/components/venue-request-sections";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

const { approveVenueRequest, navigate, invalidate, success, error } = vi.hoisted(() => ({
  approveVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  navigate: vi.fn<(input: { to: string }) => Promise<void>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}));
vi.mock("#/features/venue-requests/server-fns", () => ({
  approveVenueRequest,
  rejectVenueRequest: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ navigate, invalidate }),
}));
vi.mock("sonner", () => ({ toast: { success, error } }));

const pending: PendingVenueRequestDetail = {
  id: "request-001",
  eventId: 41,
  venueId: 3,
  venueName: "Riverside Loft",
  startsAt: "2026-11-21T18:00",
  endsAt: "2026-11-21T22:00",
  submittedAt: new Date("2026-10-14T01:00:00Z"),
  conflict: "booking",
  requirements: {
    eventTiming: "21 Nov 2026, 18:00–22:00",
    expectedAttendance: 120,
    layout: "Cabaret",
    accessibility: "Step-free entrance; quiet room available",
    requiredFacilities: "6 power drops, WiFi",
  },
};

function page(input: {
  pending?: PendingVenueRequestDetail;
  venueRequest?: EventPageData extends never ? never : unknown;
  status?: string;
}): EventPageData {
  return {
    kind: "event",
    event: {
      access: "venue_staff",
      event: {
        id: 1042,
        eventDate: "2026-11-21",
        startTime: "18:00",
        endTime: "22:00",
        status: input.status ?? "planning",
        venueRequest: (input.venueRequest as never) ?? null,
      },
    },
    venueDecision: input.pending
      ? {
          request: input.pending,
          venues: [
            { id: 3, name: "Riverside Loft" },
            { id: 4, name: "Harbor Hall" },
          ],
        }
      : null,
  } as unknown as EventPageData;
}

function renderSection(data: EventPageData, id: string) {
  cleanup();
  const section = venueRequestSections(data)
    .filter(candidate => candidate.visible(data))
    .find(candidate => candidate.id === id);
  expect(section).toBeDefined();
  render(<>{section?.render(data)}</>);
}

beforeEach(() => {
  approveVenueRequest.mockReset().mockResolvedValue({});
  navigate.mockReset().mockResolvedValue();
  invalidate.mockReset().mockResolvedValue();
  success.mockReset();
});

describe("venueRequestSections", () => {
  it("renders the pending request details with the decision controls", () => {
    const data = page({ pending });

    renderSection(data, "request");
    expect(screen.getByText("Riverside Loft")).toBeTruthy();
    expect(screen.getByText("Conflicting booking")).toBeTruthy();

    renderSection(data, "decision");
    expect(screen.getByRole("heading", { name: "Record a decision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve request for Riverside Loft/ })).toBeTruthy();
    expect(screen.getByLabelText("Reason for rejection (required)")).toBeTruthy();
  });

  it("refreshes the event page in place after an approval, without leaving for the queue", async () => {
    renderSection(page({ pending }), "decision");

    await userEvent.click(
      screen.getByRole("button", { name: /Approve request for Riverside Loft/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(
      "Booking approved for Riverside Loft from 21 Nov 2026, 18:00."
    );
  });

  it("renders the decided outcome with its banner, without the decision block", () => {
    const data = page({
      venueRequest: { id: "vr-1", status: "approved", venueName: "Harbor Hall" },
    });

    expect(
      venueRequestSections(data)
        .filter(section => section.visible(data))
        .map(section => section.id)
    ).toEqual(["request"]);

    renderSection(data, "request");
    expect(screen.getByRole("heading", { name: "Booking request details" })).toBeTruthy();
    expect(screen.getByText("Booking approved.")).toBeTruthy();
    expect(screen.getByText("Harbor Hall")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
  });

  it("hides the decision block when the event is cancelled", () => {
    const data = page({ pending, status: "cancelled" });

    expect(
      venueRequestSections(data)
        .filter(section => section.visible(data))
        .map(section => section.id)
    ).toEqual(["request"]);
  });

  it("gates the decision block on the visible data, not the built data", () => {
    const sections = venueRequestSections(page({ pending, status: "planning" }));
    const decision = sections.find(section => section.id === "decision");
    expect(decision).toBeDefined();

    expect(decision?.visible(page({ pending, status: "cancelled" }))).toBe(false);
    expect(decision?.visible(page({ pending, status: "planning" }))).toBe(true);
  });

  it("shows the rejection reason and the suggested alternative", () => {
    const data = page({
      venueRequest: {
        id: "vr-1",
        status: "rejected",
        venueName: "Riverside Loft",
        rejection: {
          venueId: 3,
          venueName: "Riverside Loft",
          date: "2026-11-21",
          startTime: "18:00",
          endTime: "22:00",
          reason: "Fully booked for a private hire that weekend.",
          suggestion: {
            venueName: "Harbor Hall",
            date: "2026-11-21",
            startTime: "18:00",
            endTime: "22:00",
          },
          suggestedVenueId: 4,
        },
      },
    });

    renderSection(data, "request");
    expect(screen.getByText("Request declined.")).toBeTruthy();
    expect(screen.getByText("Fully booked for a private hire that weekend.")).toBeTruthy();
    expect(screen.getByText(/Harbor Hall/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve request/ })).toBeNull();
  });

  it("shows the release banner with the release record", () => {
    const data = page({
      venueRequest: {
        id: "vr-1",
        status: "released",
        venueName: "Harbor Hall",
        release: {
          venueName: "Harbor Hall",
          date: "2026-11-21",
          startTime: "18:00",
          endTime: "22:00",
          reason: "Organiser moved the event outdoors.",
          changedByName: "Priya Nair",
        },
      },
    });

    renderSection(data, "request");
    expect(screen.getByText("Booking released.")).toBeTruthy();
    expect(screen.getByText("Organiser moved the event outdoors.")).toBeTruthy();
    expect(screen.getByText("Priya Nair")).toBeTruthy();
  });
});
