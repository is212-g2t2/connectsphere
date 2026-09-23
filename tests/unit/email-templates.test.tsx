import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { Layout } from "#/features/emails/components/layout";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import { ResetPasswordEmail } from "#/features/emails/components/reset-password-email";
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
});
