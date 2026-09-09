import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { Layout } from "#/features/emails/components/layout";
import { ResetPasswordEmail } from "#/features/emails/components/reset-password-email";
import { VerificationEmail } from "#/features/emails/components/verification-email";

describe("Email templates rendering", () => {
  it("renders base Layout with children and custom preview text", async () => {
    const html = await render(
      <Layout previewText="Test Preview Text">
        <p>Custom email body content</p>
      </Layout>
    );

    expect(html).toContain("TanStack Start");
    expect(html).toContain("Custom email body content");
    expect(html).toContain("Test Preview Text");
    expect(html).toContain("Sent from TanStack Start Template.");
  });

  it("renders VerificationEmail with verification link", async () => {
    const url = "https://example.com/verify-email?token=xyz123";
    const html = await render(<VerificationEmail url={url} />);

    expect(html).toContain("Welcome to TanStack Start!");
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
});
