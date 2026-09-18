import { Button, Section, Text } from "@react-email/components";
import { Layout } from "./layout";
import { emailButton, emailHeading, emailText } from "./email-styles";

interface VerificationEmailProps {
  url: string;
}

export const VerificationEmail = ({ url }: VerificationEmailProps) => {
  return (
    <Layout previewText="Verify your email address">
      <Section>
        <Text style={emailHeading}>Welcome to ConnectSphere!</Text>
        <Text style={emailText}>
          Thanks for signing up! we're excited to have you join our community. Please click the
          button below to verify your email address and get started.
        </Text>
        <Button href={url} style={emailButton}>
          Verify Email Address
        </Button>
      </Section>
    </Layout>
  );
};
