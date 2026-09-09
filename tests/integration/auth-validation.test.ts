// oxlint-disable node/no-process-env
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// integration-setup.ts provides the database (container, DATABASE_URL, schema, seed), but `#/db`
// builds its client from `bun:sql`, which vitest.config.ts aliases to a no-op stub
// (tests/shims/bun.ts) — so `db` cannot execute a query no matter what DATABASE_URL says.
// notes.test.ts sidesteps this by taking `db` as a parameter; `betterAuth()` captures the
// module-level `db` at import time and exposes no such seam, so the module itself has to be
// replaced. Mocking it rather than rebuilding `betterAuth()` keeps src/lib/auth.ts under test.
// Built via vi.hoisted so the mock factory and afterAll share one pool this file can close.
const { pool } = await vi.hoisted(async () => {
  const { Pool } = await import("pg");
  return { pool: new Pool({ connectionString: process.env.DATABASE_URL }) };
});

vi.mock("#/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("#/db/schema");
  return { client: pool, db: drizzle(pool, { schema }) };
});

// The mailer is mocked to *observe* the verification email, not to keep the suite passing:
// sendOnSignUp runs as a background task, so a real RESEND_API_KEY failure is swallowed and never
// reaches the response. That is exactly why criterion 6 needs a test — a broken verification email
// is invisible from the outside. Holding the element also yields the link, so no token spelunking.
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(to: string, subject: string, react: ReactElement<{ url?: string }>) => Promise<unknown>>()
    .mockResolvedValue({ id: "test-email" }),
}));

vi.mock("#/lib/mailer", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail,
}));

const { auth } = await import("#/lib/auth");

async function isEmailVerified(email: string): Promise<boolean> {
  const result = await pool.query<{ email_verified: boolean }>(
    'SELECT email_verified FROM "user" WHERE email = $1',
    [email]
  );
  return result.rows[0]?.email_verified ?? false;
}

/** sendOnSignUp dispatches in the background, so the send trails the sign-up response. */
async function verificationLinkFor(email: string): Promise<string> {
  await vi.waitFor(() => {
    expect(sendEmail).toHaveBeenCalledWith(email, expect.any(String), expect.anything());
  });
  const call = sendEmail.mock.calls.find(([to]) => to === email);
  const url = call?.[2].props.url;
  expect(url).toBeTruthy();
  return url as string;
}

afterAll(async () => {
  await pool.end();
});

/**
 * These go through `auth.handler` rather than `auth.api.*` on purpose: the point is to prove the
 * guards hold on the raw HTTP path an attacker would actually use, bypassing the sign-up form.
 */
const BASE_URL = "http://localhost:3000";

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function messageOf(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return "";
  }
  return (JSON.parse(text) as { message?: string }).message ?? "";
}

const STRONG_PASSWORD = "long-enough-pass1!";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

describe("auth server-side validation (PTR-5)", () => {
  describe("role cannot be self-assigned beyond the external roles", () => {
    it("refuses an internal-looking role at sign-up", async () => {
      const response = await auth.handler(
        post("/sign-up/email", {
          name: "",
          email: uniqueEmail("escalate"),
          password: STRONG_PASSWORD,
          role: "admin",
        })
      );

      expect(response.status).toBe(400);
      expect(await messageOf(response)).toMatch(/invalid option|expected one of/i);
    });

    it("refuses an arbitrary string as a role at sign-up", async () => {
      const response = await auth.handler(
        post("/sign-up/email", {
          name: "",
          email: uniqueEmail("garbage"),
          password: STRONG_PASSWORD,
          role: "event_coordinator",
        })
      );

      expect(response.status).toBe(400);
    });

    it.each(["attendee", "event_organiser"])("accepts the external role %s", async role => {
      const response = await auth.handler(
        post("/sign-up/email", {
          name: "",
          email: uniqueEmail(role),
          password: STRONG_PASSWORD,
          role,
        })
      );

      expect(response.status).toBe(200);
    });

    it("refuses escalation through /update-user after a valid sign-up", async () => {
      const email = uniqueEmail("promote");
      const signUp = await auth.handler(
        post("/sign-up/email", { name: "", email, password: STRONG_PASSWORD, role: "attendee" })
      );
      expect(signUp.status).toBe(200);

      const cookie = signUp.headers.get("set-cookie");
      expect(cookie).toBeTruthy();

      const response = await auth.handler(
        post("/update-user", { role: "admin" }, { cookie: cookie as string })
      );

      expect(response.status).toBe(400);
      expect(await messageOf(response)).toMatch(/invalid option|expected one of/i);

      // The assertion that matters: the stored role is unchanged, not merely that a 400 came back.
      const session = await auth.handler(
        new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie: cookie as string } })
      );
      const body = (await session.json()) as { user?: { role?: string } };
      expect(body.user?.role).toBe("attendee");
    });
  });

  describe("password policy is enforced past the form", () => {
    it.each([
      ["no digit and no symbol", "passwordd"],
      ["no symbol", "password12"],
      ["no digit", "password!!"],
      ["too short", "pw1!"],
    ])("refuses a password with %s", async (_label, password) => {
      const response = await auth.handler(
        post("/sign-up/email", {
          name: "",
          email: uniqueEmail("weak"),
          password,
          role: "attendee",
        })
      );

      expect(response.status).toBe(400);
    });

    it("states the policy failure rather than a generic error", async () => {
      const response = await auth.handler(
        post("/sign-up/email", {
          name: "",
          email: uniqueEmail("policy"),
          password: "passwordd",
          role: "attendee",
        })
      );

      expect(await messageOf(response)).toMatch(/must contain at least one number/i);
    });

    // These two prove the hook actually matches the path. The middleware runs before the endpoint,
    // so a deliberately bogus token / absent session still surfaces the policy error first — which
    // is exactly the signal that the path is covered, without standing up a real reset token.
    it("covers /reset-password", async () => {
      const response = await auth.handler(
        post("/reset-password", { newPassword: "passwordd", token: "not-a-real-token" })
      );

      expect(await messageOf(response)).toMatch(/must contain at least one number/i);
    });

    it("covers /change-password", async () => {
      const response = await auth.handler(
        post("/change-password", { newPassword: "passwordd", currentPassword: STRONG_PASSWORD })
      );

      expect(await messageOf(response)).toMatch(/must contain at least one number/i);
    });

    it("does not apply the policy to sign-in, so legacy passwords still work", async () => {
      const response = await auth.handler(
        post("/sign-in/email", { email: "john.doe@example.com", password: "weak" })
      );

      // Wrong credentials, not a policy rejection — the point is which error comes back.
      expect(await messageOf(response)).not.toMatch(/must contain/i);
    });
  });

  describe("email verification on sign-up (AC6)", () => {
    it("emails a verification link to the address that registered", async () => {
      const email = uniqueEmail("verify-sent");

      const response = await auth.handler(
        post("/sign-up/email", { name: "", email, password: STRONG_PASSWORD, role: "attendee" })
      );
      expect(response.status).toBe(200);

      const url = await verificationLinkFor(email);
      expect(url).toContain("/verify-email");
    });

    it("marks the account verified once that link is followed", async () => {
      const email = uniqueEmail("verify-link");

      expect(
        (
          await auth.handler(
            post("/sign-up/email", { name: "", email, password: STRONG_PASSWORD, role: "attendee" })
          )
        ).status
      ).toBe(200);

      expect(await isEmailVerified(email)).toBe(false);

      const url = await verificationLinkFor(email);
      const verified = await auth.handler(new Request(url));
      expect(verified.status).toBeLessThan(400);

      expect(await isEmailVerified(email)).toBe(true);
    });

    it("does not send a verification email when sign-up is refused", async () => {
      const email = uniqueEmail("verify-refused");

      const response = await auth.handler(
        post("/sign-up/email", { name: "", email, password: "passwordd", role: "attendee" })
      );
      expect(response.status).toBe(400);

      expect(sendEmail).not.toHaveBeenCalledWith(email, expect.any(String), expect.anything());
    });
  });

  describe("duplicate email is refused with a message (AC2)", () => {
    it("refuses a second sign-up on the same address", async () => {
      const email = uniqueEmail("dupe");
      const body = { name: "", email, password: STRONG_PASSWORD, role: "attendee" };

      expect((await auth.handler(post("/sign-up/email", body))).status).toBe(200);

      const second = await auth.handler(post("/sign-up/email", body));
      expect(second.status).toBe(422);
      expect(await messageOf(second)).toMatch(/already exists/i);
    });
  });
});
