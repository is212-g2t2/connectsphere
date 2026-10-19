import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { CoordinatorAssignedEmail } from "#/features/emails/components/coordinator-assigned-email";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { Layout } from "#/features/emails/components/layout";
import {
  EventCancellationDeclinedEmail,
  EventCancellationRequestedEmail,
  EventCancelledEmail,
} from "#/features/emails/components/event-cancellation-email";
import {
  EventChangeProcessedEmail,
  EventChangeRequestEmail,
} from "#/features/emails/components/event-change-request-email";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import { EventSubmittedEmail } from "#/features/emails/components/event-submitted-email";
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
import { VenueBlockEmail } from "#/features/emails/components/venue-block-email";
import { VenueHoldExpiryEmail } from "#/features/emails/components/venue-hold-expiry-email";
import {
  VenueHoldDeclinedEmail,
  VenueHoldPlacedEmail,
  VenueHoldRequestedEmail,
} from "#/features/emails/components/venue-hold-request-email";
import { VenueBookingReleasedByCoordinatorEmail } from "#/features/emails/components/venue-booking-released-by-coordinator-email";
import { EventConfirmedEmail } from "#/features/emails/components/event-confirmed-email";
import { EventSafetyReconfirmationEmail } from "#/features/emails/components/event-safety-reconfirmation-email";
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

  it("tells each party of an assignment in their own words (PTR-145)", async () => {
    const eventUrl = "http://localhost:3000/events/42";
    const incoming = await render(
      <CoordinatorAssignedEmail
        eventName="Community workshop"
        action="assign"
        coordinatorName="Bailey"
        audience="coordinator"
        eventUrl={eventUrl}
      />
    );
    expect(incoming).toContain("Event assigned to you");
    expect(incoming).toContain("Community workshop");
    expect(incoming).toContain(eventUrl);

    const outgoing = await render(
      <CoordinatorAssignedEmail
        eventName="Community workshop"
        action="reassign"
        coordinatorName="Bailey"
        previousCoordinatorName="Alex"
        audience="outgoing_coordinator"
      />
    );
    expect(outgoing).toContain("Event reassigned");
    expect(outgoing).toContain("no longer belongs to you");
    expect(outgoing).toContain("Bailey");
    // The outgoing Coordinator lost the event, so the copy carries no link to it.
    expect(outgoing).not.toContain("View the event");
    expect(outgoing).not.toContain(eventUrl);

    const organiser = await render(
      <CoordinatorAssignedEmail
        eventName="Community workshop"
        action="reassign"
        coordinatorName="Bailey"
        previousCoordinatorName="Alex"
        audience="organiser"
        eventUrl={eventUrl}
      />
    );
    expect(organiser).toContain("replaces Alex");
    expect(organiser).toContain("Bailey");
    // The preview matches the subject the inbox shows.
    expect(organiser).toContain("Event Coordinator changed");

    const organiserAssigned = await render(
      <CoordinatorAssignedEmail
        eventName="Community workshop"
        action="assign"
        coordinatorName="Bailey"
        audience="organiser"
        eventUrl={eventUrl}
      />
    );
    expect(organiserAssigned).toContain("is the Coordinator for");
    expect(organiserAssigned).toContain("Event Coordinator assigned");

    const incomingReassigned = await render(
      <CoordinatorAssignedEmail
        eventName="Community workshop"
        action="reassign"
        coordinatorName="Bailey"
        previousCoordinatorName="Alex"
        audience="coordinator"
        eventUrl={eventUrl}
      />
    );
    expect(incomingReassigned).toContain("It moved from Alex");
  });

  it("renders a retired handover request against the event (PTR-145 AC5)", async () => {
    const html = await render(
      <HandoverRequestEmail
        eventName="Community workshop"
        fromName="Alex"
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );

    expect(html).toContain("Handover requested");
    expect(html).toContain("Community workshop");
    expect(html).toContain("Alex");
    expect(html).toContain("http://localhost:3000/events/42");
    expect(html).toContain("View the event");
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

  /** A bare `10:00-13:30` reads as an unlabelled fragment. Call out a times-only suggestion. */
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

  it("lists every approved venue for a multi-venue registration (PTR-141 AC4)", async () => {
    const html = await render(
      <EventRegisteredEmail
        eventName="Open Day"
        venueName="Harbour Hall"
        venueLocation="Pier 3"
        startsAt="2026-12-05 10:00:00"
        endsAt="2026-12-05 16:00:00"
        eventUrl="http://localhost:3000/events/12"
        venues={[
          {
            venueName: "Harbour Hall",
            venueLocation: "Pier 3",
            startsAt: "2026-12-05 10:00:00",
            endsAt: "2026-12-05 16:00:00",
          },
          {
            venueName: "Rooftop Pavilion",
            venueLocation: "",
            startsAt: "2026-12-06 09:00:00",
            endsAt: "2026-12-06 12:00:00",
          },
        ]}
      />
    );

    expect(html).toContain("Venue: Harbour Hall, Pier 3");
    expect(html).toContain("Venue: Rooftop Pavilion");
    expect(html).toContain("5 December 2026");
    expect(html).toContain("6 December 2026");
    expect(html).not.toContain("2026-12-06 09:00:00");
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

  it("renders the Lead's cancellation copy with the queue link (PTR-144)", async () => {
    const html = await render(
      <EventCancellationRequestedEmail
        eventName="Community workshop"
        audience="lead"
        eventUrl="http://localhost:3000/coordination"
      />
    );

    expect(html).toContain("waits for assignment");
    expect(html).toContain("http://localhost:3000/coordination");
    expect(html).toContain("View the queue");
  });

  it("renders the change request for the Coordinator, and the queue for a Lead (PTR-144)", async () => {
    const coordinatorHtml = await render(
      <EventChangeRequestEmail
        eventName="Community workshop"
        whatShouldChange="Expected attendance"
        requestedValue="120"
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );
    expect(coordinatorHtml).toContain("requested a change");
    expect(coordinatorHtml).toContain("Expected attendance");
    expect(coordinatorHtml).toContain("Review the request");

    const leadHtml = await render(
      <EventChangeRequestEmail
        eventName="Community workshop"
        whatShouldChange="Expected attendance"
        requestedValue="120"
        audience="lead"
        eventRequestUrl="http://localhost:3000/coordination"
      />
    );
    expect(leadHtml).toContain("waits for assignment");
    expect(leadHtml).toContain("http://localhost:3000/coordination");
    expect(leadHtml).toContain("View the queue");
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

    // The Organiser's link opens their request. It skips the event page.
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

  it("renders the processed change request for each outcome, with the reason for a decline (PTR-52 AC5)", async () => {
    const appliedHtml = await render(
      <EventChangeProcessedEmail
        outcome="applied"
        eventName="Community workshop"
        whatShouldChange="Expected attendance"
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );
    expect(appliedHtml).toContain("Change request applied");
    expect(appliedHtml).toContain("Community workshop");
    expect(appliedHtml).toContain("Expected attendance");
    expect(appliedHtml).toContain("now shows the new information");
    expect(appliedHtml).not.toContain("Reason:");
    expect(appliedHtml).not.toContain("holds 80");
    expect(appliedHtml).toContain("http://localhost:3000/events/42");

    const declinedHtml = await render(
      <EventChangeProcessedEmail
        outcome="declined"
        eventName="Community workshop"
        whatShouldChange="Expected attendance"
        reason="The hall holds 80 at most."
        eventRequestUrl="http://localhost:3000/events/42"
      />
    );
    expect(declinedHtml).toContain("Change request declined");
    expect(declinedHtml).toContain("Reason:");
    expect(declinedHtml).toContain("The hall holds 80 at most.");
    expect(declinedHtml).not.toContain("now shows the new information");
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

  it("renders the hold expiry email with the stored warning, or without one (PTR-142)", async () => {
    const props = {
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:00:00",
      endsAt: "2026-10-12 17:00:00",
      expiresAt: "2026-10-10 12:00:00",
      calendarUrl: "http://localhost:3000/venues/availability",
    };
    const extended = await render(
      <VenueHoldExpiryEmail
        {...props}
        action="extended"
        previousExpiresAt="2026-10-08 12:00:00"
        warnAt="2026-10-07 09:00:00"
      />
    );
    expect(extended).toContain("Expiry extended on your tentative hold");
    expect(extended).toContain("now expires on 10 October 2026, 12:00");
    expect(extended).toContain("The previous expiry was 8 October 2026, 12:00");
    expect(extended).toContain("warning time stays at 7 October 2026, 09:00");
    expect(extended).toContain("http://localhost:3000/venues/availability");

    const first = await render(
      <VenueHoldExpiryEmail {...props} action="set" previousExpiresAt={null} warnAt={null} />
    );
    expect(first).toContain("Expiry set on your tentative hold");
    expect(first).not.toContain("The previous expiry was");
    expect(first).toContain("have not set a warning time");
  });

  it("renders the hold request, placement and decline emails (PTR-150)", async () => {
    const hold = {
      venueName: "Harbour Hall",
      startsAt: "2026-10-12 14:00:00",
      endsAt: "2026-10-12 17:00:00",
    };
    const requested = await render(
      <VenueHoldRequestedEmail {...hold} queueUrl="http://localhost:3000/venue-holds" />
    );
    expect(requested).toContain("Tentative hold requested");
    expect(requested).toContain("Harbour Hall for 12 October 2026, 14:00–17:00");
    expect(requested).toContain("http://localhost:3000/venue-holds");

    const placed = await render(
      <VenueHoldPlacedEmail
        {...hold}
        expiresAt="2026-10-10 12:00:00"
        calendarUrl="http://localhost:3000/venues/availability"
      />
    );
    expect(placed).toContain("Tentative hold placed");
    expect(placed).toContain("expires on 10 October 2026, 12:00");

    const declined = await render(
      <VenueHoldDeclinedEmail
        {...hold}
        reason="Reserved for exams"
        calendarUrl="http://localhost:3000/venues/availability"
      />
    );
    expect(declined).toContain("Tentative hold request declined");
    expect(declined).toContain("Reason: Reserved for exams");
  });

  it("renders the venue block email open-ended and finite", async () => {
    const openEnded = await render(
      <VenueBlockEmail
        action="blocked"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt={null}
        reason="Floor resurfacing"
      />
    );
    expect(openEnded).toContain("Venue blocked");
    expect(openEnded).toContain("Harbour Hall");
    expect(openEnded).toContain("Community workshop");
    expect(openEnded).toContain("from 12 October 2026, 14:30 until lifted");
    expect(openEnded).toContain("Floor resurfacing");

    const finite = await render(
      <VenueBlockEmail
        action="lifted"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 18:45:00"
        reason="Works finished"
      />
    );
    expect(finite).toContain("Venue available again");
    expect(finite).toContain("12 October 2026, 14:30–18:45");
    expect(finite).toContain("Works finished");

    // A lifted open-ended block is open again from the start; it never says "until lifted".
    // React separates adjacent interpolations, so assert the parts, not one string.
    const liftedOpenEnded = await render(
      <VenueBlockEmail
        action="lifted"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt={null}
        reason="Works finished"
      />
    );
    expect(liftedOpenEnded).toContain("is available again");
    expect(liftedOpenEnded).toContain("from 12 October 2026, 14:30");
    expect(liftedOpenEnded).not.toContain("until lifted");
  });

  it("names the end date of a multi-day venue block", async () => {
    const html = await render(
      <VenueBlockEmail
        action="blocked"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-14 10:00:00"
        reason="Floor resurfacing"
      />
    );
    expect(html).toContain("12 October 2026, 14:30 – 14 October 2026, 10:00");
  });

  it("tells the Coordinator the block took the event back to planning, and only then (PTR-137 AC2)", async () => {
    const reverted = await render(
      <VenueBlockEmail
        action="blocked"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 17:00:00"
        reason="Floor resurfacing"
        revertedToPlanning
      />
    );
    expect(reverted).toContain("back in planning");
    expect(reverted).toContain("confirm the event again");

    const plain = await render(
      <VenueBlockEmail
        action="blocked"
        eventName="Community workshop"
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:30:00"
        endsAt="2026-10-12 17:00:00"
        reason="Floor resurfacing"
      />
    );
    expect(plain).not.toContain("back in planning");
  });

  it("tells the Venue Staff member a Coordinator released a suspended booking, naming the booking only (PTR-137 AC4)", async () => {
    const html = await render(
      <VenueBookingReleasedByCoordinatorEmail
        venueName="Harbour Hall"
        startsAt="2026-10-12 14:00:00"
        endsAt="2026-10-12 17:00:00"
        reason="Released by the Coordinator while Harbour Hall was blocked: Floor resurfacing"
        bookingsUrl="http://localhost:3000/venue-bookings"
      />
    );
    expect(html).toContain("released by the Coordinator");
    expect(html).toContain("Harbour Hall");
    expect(html).toContain("12 October 2026");
    expect(html).toContain("The lift will not restore it.");
    expect(html).toContain("Floor resurfacing");
    expect(html).toContain("http://localhost:3000/venue-bookings");
  });

  it("renders the Attendee's copy of a re-confirmation with the arrangements (PTR-137 AC6)", async () => {
    const html = await render(
      <EventConfirmedEmail
        audience="attendee"
        eventName="Community workshop"
        venueName="Harbour Hall"
        date="12 October 2026"
        startTime="14:00"
        endTime="17:00"
        equipment={[]}
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(html).toContain("Event arrangements confirmed");
    expect(html).toContain("which you are registered for");
    expect(html).toContain("may have changed since you registered");
    expect(html).toContain("Harbour Hall");
    expect(html).toContain("View the event");
    expect(html).not.toContain("Your event is confirmed");
  });

  it("lists every approved venue on a multi-venue confirmation (PTR-141 AC4)", async () => {
    const html = await render(
      <EventConfirmedEmail
        eventName="Community workshop"
        venueName="Harbour Hall"
        date="12 October 2026"
        startTime="14:00"
        endTime="17:00"
        equipment={[]}
        eventUrl="http://localhost:3000/events/42"
        venues={[
          {
            venueName: "Harbour Hall",
            startsAt: "2026-10-12 14:00:00",
            endsAt: "2026-10-12 17:00:00",
          },
          {
            venueName: "Rooftop Pavilion",
            startsAt: "2026-10-13 09:00:00",
            endsAt: "2026-10-13 12:00:00",
          },
        ]}
      />
    );

    expect(html).toContain("Harbour Hall");
    expect(html).toContain("Rooftop Pavilion");
    expect(html).toContain("12 October 2026");
    expect(html).toContain("13 October 2026");
    expect(html).not.toContain("2026-10-13 09:00:00");
  });

  it("renders the submitted request for the Organiser and the queue for a Lead (PTR-144)", async () => {
    const organiserHtml = await render(
      <EventSubmittedEmail
        eventName="Community workshop"
        audience="organiser"
        eventUrl="http://localhost:3000/events/42"
      />
    );
    expect(organiserHtml).toContain("Event request submitted");
    expect(organiserHtml).toContain("Community workshop");
    expect(organiserHtml).toContain("is recorded");
    expect(organiserHtml).toContain("http://localhost:3000/events/42");
    expect(organiserHtml).toContain("View your request");

    const leadHtml = await render(
      <EventSubmittedEmail
        eventName="Community workshop"
        audience="lead"
        eventUrl="http://localhost:3000/coordination"
      />
    );
    expect(leadHtml).toContain("New event request");
    expect(leadHtml).toContain("Community workshop");
    expect(leadHtml).toContain("waits for a Coordinator to be assigned");
    expect(leadHtml).toContain("http://localhost:3000/coordination");
    expect(leadHtml).toContain("View the queue");
  });

  it("tells the Coordinator to get the safety review approved and confirm again (PTR-147)", async () => {
    const eventUrl = "http://localhost:3000/events/42";
    const outOfDate = await render(
      <EventSafetyReconfirmationEmail
        eventName="Community workshop"
        reason="out_of_date"
        eventRequestUrl={eventUrl}
      />
    );
    expect(outOfDate).toContain("Safety approval needs renewal");
    expect(outOfDate).toContain("the arrangements changed after the safety review");
    expect(outOfDate).toContain(
      "The Coordinator must get the safety review approved, then confirm the event again."
    );
    expect(outOfDate).toContain(eventUrl);

    const rejected = await render(
      <EventSafetyReconfirmationEmail
        eventName="Community workshop"
        reason="rejected"
        eventRequestUrl={eventUrl}
      />
    );
    expect(rejected).toContain("Safety approval needs renewal");
    expect(rejected).toContain("the safety review was rejected");
    expect(rejected).toContain(
      "The Coordinator must get the safety review approved, then confirm the event again."
    );
    expect(rejected).toContain(eventUrl);

    // PTR-148 rows queued before this deploy carry no reason. Keep them readable.
    const legacy = await render(
      <EventSafetyReconfirmationEmail eventName="Community workshop" eventRequestUrl={eventUrl} />
    );
    expect(legacy).toContain("Safety approval needs renewal");
    expect(legacy).toContain("its safety approval is no longer current");
    expect(legacy).toContain(eventUrl);
  });
});
