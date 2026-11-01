// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

const request: PendingVenueRequestDetail = {
  id: "request-001",
  venueId: 3,
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  conflict: "booking",
  requirements: {
    eventTiming: "Doors open at 09:00; event starts at 09:30.",
    expectedAttendance: 85,
    layout: "Cabaret",
    accessibilityRequirements: "Step-free access and two reserved wheelchair spaces.",
    requiredFacilities: "Projector\nTwo wireless microphones",
  },
};

function detailValue(term: string) {
  const value = screen.getByText(term).nextElementSibling;
  expect(value?.tagName).toBe("DD");
  return value as HTMLElement;
}

describe("BookingRequestDetails component slice (PTR-32)", () => {
  it("shows the chosen venue, exact local times, submission instant, and every live requirement category (TC04, TC05)", () => {
    render(<BookingRequestDetails request={request} />);

    expect(detailValue("Venue").textContent).toBe("Orchid Room");
    expect(detailValue("Starts at").textContent).toBe("18 Nov 2030, 09:30");
    expect(detailValue("Ends at").textContent).toBe("18 Nov 2030, 12:00");
    const submission = detailValue("Submitted").querySelector("time");
    expect(submission?.textContent).toBe("1 Nov 2030, 09:00");
    expect(submission?.dateTime).toBe("2030-11-01T01:00:00.000Z");
    expect(detailValue("Event timing").textContent).toBe(
      "Doors open at 09:00; event starts at 09:30."
    );
    expect(detailValue("Expected attendance").textContent).toBe("85");
    expect(detailValue("Layout").textContent).toBe("Cabaret");
    expect(detailValue("Accessibility").textContent).toBe(
      "Step-free access and two reserved wheelchair spaces."
    );
    // The requirements call this pair "Facilities".
    expect(detailValue("Facilities").textContent).toBe("Projector\nTwo wireless microphones");
    expect(screen.getByText("Conflicting booking")).toBeTruthy();
  });

  it("labels a hold-kind conflict as a conflicting hold, not a booking", () => {
    render(<BookingRequestDetails request={{ ...request, conflict: "hold" }} />);

    expect(screen.getByText("Conflicting hold")).toBeTruthy();
    expect(screen.queryByText("Conflicting booking")).toBeNull();
  });

  it("labels a blocked venue as Venue blocked and closed hours as Outside operating hours", () => {
    render(<BookingRequestDetails request={{ ...request, conflict: "blocked" }} />);

    expect(screen.getByText("Venue blocked")).toBeTruthy();
    expect(screen.queryByText("Conflicting booking")).toBeNull();
  });

  it("labels hours outside opening as Outside operating hours", () => {
    render(<BookingRequestDetails request={{ ...request, conflict: "unavailable" }} />);

    expect(screen.getByText("Outside operating hours")).toBeTruthy();
    expect(screen.queryByText("Conflicting booking")).toBeNull();
  });

  it("draws no conflict badge when the request has no conflict", () => {
    render(<BookingRequestDetails request={{ ...request, conflict: null }} />);

    expect(screen.queryByText("Conflicting hold")).toBeNull();
    expect(screen.queryByText("Conflicting booking")).toBeNull();
  });

  it("refreshes venue, start, and requirements when rendered with a different selected request (TC06)", () => {
    const { rerender } = render(<BookingRequestDetails request={request} />);
    const replacement: PendingVenueRequestDetail = {
      ...request,
      id: "request-002",
      venueName: "Harbour Hall",
      startsAt: "2030-12-01T18:00",
      requirements: {
        ...request.requirements,
        expectedAttendance: 200,
        requiredFacilities: "Stage lighting",
      },
    };

    rerender(<BookingRequestDetails request={replacement} />);

    expect(detailValue("Venue").textContent).toBe("Harbour Hall");
    expect(detailValue("Starts at").textContent).toBe("1 Dec 2030, 18:00");
    expect(detailValue("Expected attendance").textContent).toBe("200");
    expect(detailValue("Facilities").textContent).toBe("Stage lighting");
    // Keep the previous request's identity out of the replacement.
    expect(screen.queryByText("Orchid Room")).toBeNull();
    expect(screen.queryByText("18 Nov 2030, 09:30")).toBeNull();
    expect(screen.queryByText("85")).toBeNull();
    expect(screen.queryByText("Projector\nTwo wireless microphones")).toBeNull();
  });

  it("renders a zero expected attendance as 0 rather than dropping the term", () => {
    render(
      <BookingRequestDetails
        request={{
          ...request,
          requirements: { ...request.requirements, expectedAttendance: 0 },
        }}
      />
    );

    expect(detailValue("Expected attendance").textContent).toBe("0");
  });

  it("drops blank optional requirement fields, including whitespace-only text, and preserves long multiline live text (TC13)", () => {
    const longMultilineTiming = `Setup starts at 07:30.\nPlease keep the east entrance clear for deliveries.\nThe organising team will arrive at 08:15.`;
    render(
      <BookingRequestDetails
        request={{
          ...request,
          requirements: {
            ...request.requirements,
            eventTiming: longMultilineTiming,
            expectedAttendance: null,
            layout: "   ",
            accessibilityRequirements: "",
            requiredFacilities: "",
          },
        }}
      />
    );

    const timing = screen.getByText(
      (_, element) => element?.tagName === "DD" && element.textContent === longMultilineTiming
    );
    expect(timing.textContent).toBe(longMultilineTiming);
    expect(timing.className).toContain("whitespace-pre-line");
    // The requirements skip blank terms with no fallback text.
    expect(screen.queryByText("Expected attendance")).toBeNull();
    expect(screen.queryByText("Layout")).toBeNull();
    expect(screen.queryByText("Accessibility")).toBeNull();
    expect(screen.queryByText("Facilities")).toBeNull();
  });

  it("names the layout by the maintained list's label", () => {
    render(
      <BookingRequestDetails
        request={{
          ...request,
          requirements: { ...request.requirements, layout: "Grand Theatre" },
        }}
        layouts={[{ key: "grand", label: "Grand Theatre" }]}
      />
    );

    // The initials would read this text as "Theatre". The maintained list names it fully.
    expect(detailValue("Layout").textContent).toBe("Grand Theatre");
  });

  it("offers no approval, rejection, assignment, or other mutation controls (TC20)", () => {
    render(<BookingRequestDetails request={request} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/\b(approve|reject|assign|update)\b/i)).toBeNull();
  });
});
