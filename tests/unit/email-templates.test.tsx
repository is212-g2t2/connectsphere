import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { Layout } from "#/features/emails/components/layout";
import {
  EventCancellationDeclinedEmail,
  EventCancellationRequestedEmail,
  EventCancelledEmail,
} from "#/features/emails/components/event-cancellation-email";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import { EventSignificantChangeEmail } from "#/features/emails/components/event-significant-change-email";
import {
  EventRegisteredEmail,
  RegistrationPlaceFreedEmail,
  RegistrationThresholdEmail,
  RegistrationWindowEmail,
} from "#/features/emails/components/event-registration-email";
import { HandoverAcceptedEmail } from "#/features/emails/components/handover-accepted-email";
import { HandoverDeclinedEmail } from "#/features/emails/components/handover-declined-email";
import { HandoverRequestEmail } from "#/features/emails/components/handover-request-email";
import { ResetPasswordEmail } from "#/features/emails/components/reset-password-email";
import { VenueBookingApprovedEmail } from "#/features/emails/components/venue-booking-approved-email";
import { VenueBookingRejectedEmail } from "#/features/emails/components/venue-booking-rejected-email";
import { VenueBookingRequestEmail } from "#/features/emails/components/venue-booking-request-email";
import { VerificationEmail } from "#/features/emails/components/verification-email";

describe("Email templates rendering", () => {
  it("renders the reply and question as escaped text with a Coordinator review link", async () => {
    const html = await render(
      <ClarificationReplyEmail
        eventName="Community workshop"
        question={'Can you use <script>alert("question")</script>?'}
        body={'Yes.\n<img src=x onerror="alert(1)">'}
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );
    expect(html).toContain("Clarification replied");
    expect(html).toContain("http://localhost:3000/events/42");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("white-space:pre-line");
  });
  it("renders base Layout with children and custom preview text", async () => {
    const html = await render(
      <Layout previewText="Test Preview Text">
        <p>Custom email body content</p>
      </Layout>
    );

    expect(html).toContain("ConnectSphere");
    expect(html).toContain("Custom email body content");
    expect(html).toContain("Test Preview Text");
    expect(html).toContain("Sent from ConnectSphere.");
  });

  it("renders VerificationEmail with verification link", async () => {
    const url = "https://example.com/verify-email?token=xyz123";
    const html = await render(<VerificationEmail url={url} />);

    expect(html).toContain("Welcome to ConnectSphere!");
    expect(html).toContain(url);
    expect(html).toContain("Verify Email Address");
    expect(html).toContain("Verify your email address");
  });

  it("renders ResetPasswordEmail with reset link and user email", async () => {
    const url = "https://example.com/reset-password?token=abc456";
    const user = { email: "user@example.com" };
    const html = await render(<ResetPasswordEmail url={url} user={user} />);

    expect(html).toContain("Password Reset Request");
    expect(html).toContain("user@example.com");
    expect(html).toContain(url);
    expect(html).toContain("Reset Your Password");
    expect(html).toContain("This link will expire in 1 hour.");
  });

  it("renders the event decision, rejection reason, and request link", async () => {
    const eventRequestUrl = "http://localhost:3000/events/42";
    const html = await render(
      <EventDecisionEmail
        eventName="Community workshop"
        decision="rejected"
        reason="The requested room is unavailable."
        eventRequestUrl={eventRequestUrl}
      />
    );

    expect(html).toContain("Community workshop");
    expect(html).toContain("rejected");
    expect(html).toContain("The requested room is unavailable.");
    expect(html).toContain(eventRequestUrl);
  });

  it("renders the handover request with the event, who offered it, and the coordination link (PTR-110 AC1)", async () => {
    const html = await render(
      <HandoverRequestEmail
        eventName="Community workshop"
        fromName="Alex"
        coordinationUrl="http://localhost:3000/coordination"
      />
    );

    expect(html).toContain("Handover requested");
    expect(html).toContain("Community workshop");
    expect(html).toContain("Alex");
    expect(html).toContain("http://localhost:3000/coordination");
    expect(html).toContain("Review the handover");
  });

  it("renders the accepted handover with the new Coordinator and the organiser's request (PTR-110 AC3)", async () => {
    const html = await render(
      <HandoverAcceptedEmail
        eventName="Community workshop"
        coordinatorName="Bailey"
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );

    expect(html).toContain("A new Coordinator for your event");
    expect(html).toContain("Bailey");
    expect(html).toContain("Community workshop");
    expect(html).toContain("http://localhost:3000/events/42");
  });

  it("renders the declined handover with the incoming Coordinator and the outgoing one's request (PTR-110 AC4)", async () => {
    const html = await render(
      <HandoverDeclinedEmail
        eventName="Community workshop"
        coordinatorName="Bailey"
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );

    expect(html).toContain("Handover declined");
    expect(html).toContain("Bailey");
    expect(html).toContain("Community workshop");
    expect(html).toContain("You remain its Event Coordinator.");
    expect(html).toContain("http://localhost:3000/events/42");
  });

  it("renders ClarificationRequestEmail with the event name, clarification body, and action button", async () => {
    const eventName = "Tech Innovation Summit";
    const body = "Please clarify how many projectors and microphones you will need.";
    const eventRequestUrl = "http://localhost:3000/events/42";

    const html = await render(
      <ClarificationRequestEmail
        eventName={eventName}
        body={body}
        eventRequestUrl={eventRequestUrl}
      />
    );

    expect(html).toContain("Clarification requested");
    expect(html).toContain(eventName);
    expect(html).toContain(body);
    expect(html).toContain(eventRequestUrl);
    expect(html).toContain("View your request");
    expect(html).toContain("Sent from ConnectSphere.");
  });

  it("renders VenueBookingRequestEmail with the venue, window, and expected attendance", async () => {
    const html = await render(
      <VenueBookingRequestEmail
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        expectedAttendance={120}
        layout="Theatre seating"
        accessibilityRequirements="Step-free access"
        requiredFacilities="Projector, PA system"
      />
    );

    expect(html).toContain("Venue booking requested");
    expect(html).toContain("Harbour Hall");
    expect(html).toContain("12 October 2026");
    expect(html).toContain("14:30–18:45");
    expect(html).toContain("Expected attendance: 120");
    expect(html).toContain("pending booking requests");
  });

  it("renders one requirement line per non-empty venue requirement (PTR-31 AC2)", async () => {
    const html = await render(
      <VenueBookingRequestEmail
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        expectedAttendance={120}
        layout="Theatre seating"
        accessibilityRequirements="Step-free access"
        requiredFacilities="Projector, PA system"
      />
    );

    expect(html).toContain("Layout: Theatre seating");
    expect(html).toContain("Accessibility requirements: Step-free access");
    expect(html).toContain("Required facilities: Projector, PA system");
  });

  it("omits empty venue requirement lines (PTR-31 AC2)", async () => {
    const html = await render(
      <VenueBookingRequestEmail
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        expectedAttendance={null}
        layout=""
        accessibilityRequirements=""
        requiredFacilities=""
      />
    );

    expect(html).not.toContain("Layout:");
    expect(html).not.toContain("Accessibility requirements:");
    expect(html).not.toContain("Required facilities:");
    expect(html).not.toContain("Expected attendance");
  });

  it("renders VenueBookingApprovedEmail with the event, venue and exact period (PTR-33 AC2)", async () => {
    const html = await render(
      <VenueBookingApprovedEmail
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
      />
    );

    expect(html).toContain("Venue booking approved");
    expect(html).toContain("Community workshop");
    expect(html).toContain("Harbour Hall");
    expect(html).toContain("12 October 2026, 14:30–18:45");
  });

  it("renders VenueBookingRejectedEmail with the reason and a suggested alternative (PTR-34 AC4)", async () => {
    const html = await render(
      <VenueBookingRejectedEmail
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        reason="Closed for floor resurfacing"
        suggestion={{
          venueName: "Seminar Room 2A",
          date: "2026-10-14",
          startTime: "10:00",
          endTime: "13:30",
        }}
      />
    );

    expect(html).toContain("Venue booking rejected");
    expect(html).toContain("Community workshop");
    expect(html).toContain("Harbour Hall");
    expect(html).toContain("12 October 2026, 14:30–18:45");
    expect(html).toContain("Closed for floor resurfacing");
    expect(html).toContain("Suggested instead: Seminar Room 2A, 14 October 2026, 10:00–13:30.");
  });

  it("renders only the parts of a suggestion that were given, and none when there is not one (PTR-34 AC2)", async () => {
    const base = {
      eventName: "Community workshop",
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:30:00",
      endsAt: "2026-10-12 18:45:00",
      reason: "Fully booked",
    };

    const dateOnly = await render(
      <VenueBookingRejectedEmail
        {...base}
        suggestion={{ venueName: null, date: "2026-10-14", startTime: null, endTime: null }}
      />
    );
    expect(dateOnly).toContain("Suggested instead: 14 October 2026.");

    const none = await render(<VenueBookingRejectedEmail {...base} suggestion={null} />);
    expect(none).toContain("Fully booked");
    expect(none).not.toContain("Suggested instead");
  });

  /** A bare `10:00–13:30` reads as an unlabelled fragment; a times-only suggestion is called out. */
  it("labels a suggestion that is only a new time, rather than a bare time range", async () => {
    const html = await render(
      <VenueBookingRejectedEmail
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        reason="Fully booked"
        suggestion={{ venueName: null, date: null, startTime: "10:00", endTime: "13:30" }}
      />
    );
    expect(html).toContain("Suggested instead: New time: 10:00–13:30.");
  });

  it("renders EventRegisteredEmail with the event, its venue and period, and the event link (PTR-45 AC7)", async () => {
    const html = await render(
      <EventRegisteredEmail
        eventName="Open Day"
        venueName="Seminar Room 2A"
        venueLocation="Level 2, Marina Centre"
        startsAt="2026-12-05 10:00:00"
        endsAt="2026-12-05 16:00:00"
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("You are registered");
    expect(html).toContain("Open Day");
    expect(html).toContain("When: 5 December 2026, 10:00–16:00");
    expect(html).toContain("Venue: Seminar Room 2A, Level 2, Marina Centre");
    expect(html).toContain("http://localhost:3000/events/12");
  });

  it("names both days of a registered event that ends on a later day", async () => {
    const html = await render(
      <EventRegisteredEmail
        eventName="Night Market"
        venueName="Rooftop Pavilion"
        venueLocation=""
        startsAt="2026-12-05 22:00:00"
        endsAt="2026-12-06 02:00:00"
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("When: 5 December 2026, 22:00 – 6 December 2026, 02:00");
    expect(html).toContain("Venue: Rooftop Pavilion");
    expect(html).not.toContain("Rooftop Pavilion, ");
  });

  it("renders RegistrationThresholdEmail at the limit with the places and the event link (PTR-45 AC8)", async () => {
    const html = await render(
      <RegistrationThresholdEmail
        eventName="Open Day"
        registered={40}
        limit={40}
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("Registration is full");
    expect(html).toContain("Open Day");
    expect(html).toContain("40 of 40 places are taken. Attendees can no longer register.");
    expect(html).toContain("http://localhost:3000/events/12");
  });

  it("renders RegistrationThresholdEmail as nearly full below the limit (PTR-45 AC9)", async () => {
    const html = await render(
      <RegistrationThresholdEmail
        eventName="Open Day"
        registered={36}
        limit={40}
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("Registration is nearly full");
    expect(html).toContain("36 of 40 places are taken.");
    expect(html).not.toContain("can no longer register");
  });

  it("renders RegistrationPlaceFreedEmail with event, limit and review link (PTR-47 AC4)", async () => {
    const html = await render(
      <RegistrationPlaceFreedEmail
        eventName="Open Day"
        limit={40}
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("A place has been freed");
    expect(html).toContain("Open Day");
    expect(html.replaceAll("<!-- -->", "")).toContain("one more place free (limit: 40)");
    expect(html).toContain("http://localhost:3000/events/12");
  });

  it("renders RegistrationWindowEmail when opened", async () => {
    const html = await render(
      <RegistrationWindowEmail
        eventName="Open Day"
        boundary="opened"
        time="2026-12-05 10:00:00"
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("Registration has opened");
    expect(html).toContain("Open Day");
    expect(html).toContain("registration opened on 5\u00A0December\u00A02026 at 10:00.");
    expect(html).toContain("http://localhost:3000/events/12");
  });

  it("renders RegistrationWindowEmail when closed", async () => {
    const html = await render(
      <RegistrationWindowEmail
        eventName="Open Day"
        boundary="closed"
        time="2026-12-05 16:00:00"
        eventUrl="http://localhost:3000/events/12"
      />
    );

    expect(html).toContain("Registration has closed");
    expect(html).toContain("Open Day");
    expect(html).toContain("registration closed on 5\u00A0December\u00A02026 at 16:00.");
    expect(html).toContain("http://localhost:3000/events/12");
  });
  it("renders the cancellation request with the event and the coordination link (PTR-53 AC3)", async () => {
    const eventUrl = "http://localhost:3000/events/42";
    const html = await render(
      <EventCancellationRequestedEmail eventName="Community workshop" eventUrl={eventUrl} />
    );

    expect(html).toContain("Community workshop");
    expect(html).toContain("asked for this event to be cancelled");
    expect(html).toContain(eventUrl);
  });

  it("renders the cancellation for each party, naming the booking to Venue Staff (PTR-54 AC3, AC4, AC7)", async () => {
    const attendeeHtml = await render(
      <EventCancelledEmail
        audience="attendee"
        eventName="Community workshop"
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(attendeeHtml).toContain("Community workshop");
    expect(attendeeHtml).toContain("has been cancelled");
    expect(attendeeHtml).toContain("http://localhost:3000/events/42");
    expect(attendeeHtml).toContain("View the event");

    // The Organiser's link opens their request, not the event page.
    const organiserHtml = await render(
      <EventCancelledEmail
        audience="organiser"
        eventName="Community workshop"
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(organiserHtml).toContain("View your request");
    expect(organiserHtml).not.toContain("View the event");

    const venueHtml = await render(
      <EventCancelledEmail
        audience="venue_staff"
        venueName="Seminar Room 2A"
        startsAt="2026-12-05 10:00:00"
        endsAt="2026-12-05 16:00:00"
        eventUrl="http://localhost:3000/venue-bookings"
      />
    );
    expect(venueHtml).toContain("Seminar Room 2A");
    expect(venueHtml).toContain("5 December 2026");
    expect(venueHtml).toContain("10:00");
    expect(venueHtml).toContain("release");

    const techHtml = await render(
      <EventCancelledEmail
        audience="technical_support"
        eventName="Community workshop"
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(techHtml).toContain("release");
  });

  it("renders the significant change to each holder, naming the booking to Venue Staff and the event to Technical Support (PTR-23 AC5)", async () => {
    const venueHtml = await render(
      <EventSignificantChangeEmail
        audience="venue_staff"
        venueName="Seminar Room 2A"
        startsAt="2026-12-05 10:00:00"
        endsAt="2026-12-05 16:00:00"
        changedFields={["proposedDates", "expectedAttendance"]}
        actorName="Alex Tan"
        arrangementUrl="http://localhost:3000/venue-bookings"
      />
    );
    expect(venueHtml).toContain("Alex Tan");
    expect(venueHtml).toContain("proposed dates and times and expected attendance");
    expect(venueHtml).toContain("Seminar Room 2A");
    expect(venueHtml).toContain("5 December 2026");
    expect(venueHtml).toContain("10:00");
    expect(venueHtml).toContain("still held");
    expect(venueHtml).toContain("http://localhost:3000/venue-bookings");
    expect(venueHtml).toContain("View venue bookings");

    const techHtml = await render(
      <EventSignificantChangeEmail
        audience="technical_support"
        eventName="Community workshop"
        changedFields={["equipmentRequirements"]}
        actorName="Alex Tan"
        arrangementUrl="http://localhost:3000/events/42"
      />
    );
    expect(techHtml).toContain("Community workshop");
    expect(techHtml).toContain("equipment requirements");
    expect(techHtml).not.toContain("and equipment requirements");
    expect(techHtml).toContain("reservations are unchanged");
    expect(techHtml).toContain("http://localhost:3000/events/42");
    expect(techHtml).toContain("View the event");
  });

  it("renders the declined cancellation request with the reason (PTR-54 AC8)", async () => {
    const html = await render(
      <EventCancellationDeclinedEmail
        eventName="Community workshop"
        reason="The deposit is non-refundable."
        eventUrl="http://localhost:3000/events/42"
      />
    );

    expect(html).toContain("Community workshop");
    expect(html).toContain("The deposit is non-refundable.");
    expect(html).toContain("http://localhost:3000/events/42");
  });
});
