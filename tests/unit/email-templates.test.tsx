import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { Layout } from "#/features/emails/components/layout";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
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
        eventRequestUrl="http://localhost:3000/coordination/42"
      />
    );
    expect(html).toContain("Clarification replied");
    expect(html).toContain("http://localhost:3000/coordination/42");
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
    const eventRequestUrl = "http://localhost:3000/event-requests/42";
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

  it("renders ClarificationRequestEmail with the event name, clarification body, and action button", async () => {
    const eventName = "Tech Innovation Summit";
    const body = "Please clarify how many projectors and microphones you will need.";
    const eventRequestUrl = "http://localhost:3000/event-requests/42";

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
      <VenueBookingRejectedEmail {...base} suggestion={{ date: "2026-10-14" }} />
    );
    expect(dateOnly).toContain("Suggested instead: 14 October 2026.");

    const none = await render(<VenueBookingRejectedEmail {...base} suggestion={null} />);
    expect(none).toContain("Fully booked");
    expect(none).not.toContain("Suggested instead");
  });
});
