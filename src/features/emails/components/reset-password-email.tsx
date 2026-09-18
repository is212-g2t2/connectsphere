import { Button, Section, Text } from "@react-email/components";
import { Layout } from "./layout";
import { emailButton, emailCaption, emailHeading, emailText } from "./email-styles";

interface ResetPasswordEmailProps {
  url: string;
  user: { email: string };
}

export const ResetPasswordEmail = ({ url, user }: ResetPasswordEmailProps) => {
  return (
    <Layout previewText="Reset your password">
      <Section>
        <Text style={emailHeading}>Password Reset Request</Text>
        <Text style={emailText}>
          Hi there,
          <br />
          <br />
          We received a request to reset the password for your account ({user.email}). If this was
          you, click the button below to set a new password.
        </Text>
        <Button href={url} style={emailButton}>
          Reset Your Password
        </Button>
        <Text style={subtext}>
          If you did not request a password reset, please ignore this email. Your password will not
          be changed.
          <br />
          <br />
          This link will expire in 1 hour.
        </Text>
      </Section>
    </Layout>
  );
};

const subtext = {
  ...emailCaption,
  margin: "24px 0 0",
};
