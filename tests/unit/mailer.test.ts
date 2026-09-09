import { createMailer, sendEmail } from "#/lib/mailer";
import * as React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockEmailsSend, mockEnv } = vi.hoisted(() => {
  const env: { RESEND_API_KEY?: string; EMAIL_FROM?: string } = {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Sender <from@example.com>",
  };
  return { mockEmailsSend: vi.fn<(...args: unknown[]) => unknown>(), mockEnv: env };
});

vi.mock("resend", () => ({
  Resend: vi.fn<(...args: unknown[]) => unknown>(function () {
    return { emails: { send: mockEmailsSend } };
  }),
}));

vi.mock("#/env", () => ({ env: mockEnv }));

vi.mock("#/lib/logger", () => ({
  logger: {
    info: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
  },
}));

describe("createMailer", () => {
  test("returns null when apiKey is undefined", () => {
    expect(createMailer(undefined)).toBeNull();
  });

  test("returns null when apiKey is empty string", () => {
    expect(createMailer("")).toBeNull();
  });

  test("returns Resend instance when apiKey is provided", () => {
    expect(createMailer("re_abc123")).not.toBeNull();
  });
});

describe("sendEmail", () => {
  const element = React.createElement("div");

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.EMAIL_FROM = "Sender <from@example.com>";
  });

  test("throws when RESEND_API_KEY is not set", async () => {
    mockEnv.RESEND_API_KEY = undefined;
    await expect(sendEmail("to@example.com", "Subject", element)).rejects.toThrow(
      "RESEND_API_KEY is not configured"
    );
  });

  test("sends email with correct params and returns data", async () => {
    const data = { id: "email_123" };
    mockEmailsSend.mockResolvedValue({ data, error: null });

    const result = await sendEmail("to@example.com", "Hello", element);

    expect(mockEmailsSend).toHaveBeenCalledWith({
      from: "Sender <from@example.com>",
      to: "to@example.com",
      subject: "Hello",
      react: element,
    });
    expect(result).toEqual(data);
  });

  test("uses default from address when EMAIL_FROM is not set", async () => {
    mockEnv.EMAIL_FROM = undefined;
    mockEmailsSend.mockResolvedValue({ data: { id: "x" }, error: null });

    await sendEmail("to@example.com", "Hello", element);

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: "TanStack Start <onboarding@resend.dev>" })
    );
  });

  test("throws when Resend returns an error", async () => {
    mockEmailsSend.mockResolvedValue({ data: null, error: { message: "Invalid API key" } });

    await expect(sendEmail("to@example.com", "Subject", element)).rejects.toThrow(
      "Failed to send email"
    );
  });
});
