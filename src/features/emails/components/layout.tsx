import * as React from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

import { emailCaption } from "./email-styles";

interface LayoutProps {
  previewText?: string;
  children: React.ReactNode;
}

export const Layout = ({ previewText, children }: LayoutProps) => {
  return (
    <Html>
      <Head />
      <Preview>{previewText || ""}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={logo}>ConnectSphere</Text>
          </Section>
          <Section style={content}>{children}</Section>
          <Hr style={hr} />
          <Section style={footer}>
            <Text style={footerText}>Sent from ConnectSphere.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: "#f6f6f4",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
  padding: "32px 16px",
};

const container = {
  margin: "0 auto",
  padding: "24px",
  maxWidth: "580px",
  backgroundColor: "#ffffff",
  border: "1px solid rgba(21, 21, 21, 0.08)",
  borderRadius: "16px",
};

const header = {
  padding: "0 0 24px",
};

const logo = {
  fontSize: "24px",
  fontWeight: "600",
  letterSpacing: "-0.03em",
  color: "#151515",
  margin: "0",
};

const content = {
  padding: "0 0 24px",
};

const hr = {
  borderColor: "rgba(21, 21, 21, 0.08)",
  margin: "0 0 24px",
};

const footer = {
  padding: "0",
};

const footerText = {
  ...emailCaption,
  margin: "0",
};
