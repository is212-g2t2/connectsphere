import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import type { BookingRequestDetail } from "#/features/venue-requests/types";

const request: BookingRequestDetail = {
  id: "request-001",
  venueName: "Orchid Room",
  startsAt: "2030-11-18T09:30",
  endsAt: "2030-11-18T12:00",
  submittedAt: new Date("2030-11-01T01:00:00Z"),
  requirements: {
    eventTiming: "Doors open at 09:00; event starts at 09:30.",
    expectedAttendance: 85,
    layout: "Cabaret",
    accessibility: "Step-free access and two reserved wheelchair spaces.",
    requiredFacilities: ["Projector", "Two wireless microphones"],
  },
};

function detailValue(term: string) {
  const value = screen.getByText(term).nextElementSibling;
  expect(value?.tagName).toBe("DD");
  return value as HTMLElement;
}

describe("BookingRequestDetails component slice (PTR-32)", () => {
  it("shows the chosen venue, exact local times, submission instant, and every snapshot category (TC04, TC05)", () => {
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
    expect(detailValue("Required facilities").textContent).toBe(
      "Projector, Two wireless microphones"
    );
  });

  it("refreshes all fields when rendered with a different selected request (TC06)", () => {
    const { rerender } = render(<BookingRequestDetails request={request} />);
    const replacement: BookingRequestDetail = {
      ...request,
      id: "request-002",
      venueName: "Harbour Hall",
      startsAt: "2030-12-01T18:00",
      endsAt: "2030-12-01T21:00",
      submittedAt: new Date("2030-11-02T01:00:00Z"),
      requirements: {
        eventTiming: "Sound check at 17:00.",
        expectedAttendance: 120,
        layout: "Theatre",
        accessibility: "Hearing loop requested.",
        requiredFacilities: ["Stage lighting"],
      },
    };

    rerender(<BookingRequestDetails request={replacement} />);

    expect(detailValue("Venue").textContent).toBe("Harbour Hall");
    expect(detailValue("Starts at").textContent).toBe("1 Dec 2030, 18:00");
    expect(detailValue("Ends at").textContent).toBe("1 Dec 2030, 21:00");
    expect(detailValue("Submitted").textContent).toBe("2 Nov 2030, 09:00");
    expect(detailValue("Event timing").textContent).toBe("Sound check at 17:00.");
    expect(detailValue("Expected attendance").textContent).toBe("120");
    expect(detailValue("Layout").textContent).toBe("Theatre");
    expect(detailValue("Accessibility").textContent).toBe("Hearing loop requested.");
    expect(detailValue("Required facilities").textContent).toBe("Stage lighting");
    expect(screen.queryByText("Orchid Room")).toBeNull();
    expect(screen.queryByText("Doors open at 09:00; event starts at 09:30.")).toBeNull();
    expect(screen.queryByText("85")).toBeNull();
    expect(screen.queryByText("Cabaret")).toBeNull();
    expect(screen.queryByText("Step-free access and two reserved wheelchair spaces.")).toBeNull();
    expect(screen.queryByText("Projector")).toBeNull();
  });

  it("makes blank optional fields explicit and preserves long multiline snapshot text (TC13)", () => {
    const longMultilineTiming = `Setup starts at 07:30.\nPlease keep the east entrance clear for deliveries.\nThe organising team will arrive at 08:15.`;
    render(
      <BookingRequestDetails
        request={{
          ...request,
          requirements: {
            ...request.requirements,
            eventTiming: longMultilineTiming,
            layout: "   ",
            accessibility: null,
            requiredFacilities: [],
          },
        }}
      />
    );

    const timing = screen.getByText(
      (_, element) => element?.tagName === "DD" && element.textContent === longMultilineTiming
    );
    expect(timing.textContent).toBe(longMultilineTiming);
    expect(screen.getAllByText("None specified")).toHaveLength(3);
  });

  it("offers no approval, rejection, assignment, or other mutation controls (TC20)", () => {
    render(<BookingRequestDetails request={request} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/approve|reject|assign|update/i)).toBeNull();
  });
});
