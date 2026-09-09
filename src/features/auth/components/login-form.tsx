import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";
import { useEffect, useState } from "react";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);

  const handlePasskeySignIn = async () => {
    setServerError(null);
    setPasskeyLoading(true);
    const result = await authClient.signIn.passkey({
      fetchOptions: {
        onSuccess: () => navigate({ to: "/" }),
        onError: ctx => setServerError(ctx.error.message),
      },
    });
    if (result.error) {
      setServerError(result.error.message ?? "Passkey sign-in failed.");
    }
    setPasskeyLoading(false);
  };

  useEffect(() => {
    void (async () => {
      const available = await PublicKeyCredential.isConditionalMediationAvailable();
      if (!available) return;
      void authClient.signIn.passkey({
        autoFill: true,
        fetchOptions: {
          onSuccess: () => navigate({ to: "/" }),
        },
      });
    })();
  }, [navigate]);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (error) {
        setServerError(error.message ?? "Invalid email or password.");
        return;
      }
      await navigate({ to: "/" });
    },
  });

  const handleOtpSignIn = async () => {
    setServerError(null);
    const email = form.getFieldValue("email");
    if (!z.email().safeParse(email).success) {
      setServerError("Enter a valid email address to receive a code.");
      return;
    }
    setOtpLoading(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    setOtpLoading(false);
    if (error) {
      setServerError(error.message ?? "Failed to send code. Try again.");
      return;
    }
    await navigate({ to: "/verify-otp", search: { email, flow: "sign-in" } });
  };

  return (
    <div className={cn("flex flex-col gap-5", className)} {...props}>
      <form
        onSubmit={e => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup className="gap-5">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="font-heading text-2xl font-bold tracking-tight">Welcome back</h1>
            <FieldDescription>
              Don&apos;t have an account? <Link to="/signup">Sign up</Link>
            </FieldDescription>
          </div>

          <form.Field name="email">
            {field => (
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username webauthn"
                  placeholder="you@example.com"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="password">
            {field => (
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
                <FieldDescription>
                  <Link to="/reset-password">Forgot your password?</Link>
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          {serverError && <FieldError>{serverError}</FieldError>}

          <form.Subscribe selector={s => s.isSubmitting}>
            {isSubmitting => (
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </Button>
              </Field>
            )}
          </form.Subscribe>

          <FieldSeparator>Or</FieldSeparator>

          <Field className="grid gap-3">
            <Button
              variant="outline"
              type="button"
              disabled={otpLoading}
              onClick={() => void handleOtpSignIn()}
            >
              {otpLoading ? "Sending code..." : "Email me a sign-in code"}
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={passkeyLoading}
              onClick={() => void handlePasskeySignIn()}
            >
              {passkeyLoading ? "Waiting..." : "Sign in with passkey"}
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                void authClient.signIn.social({ provider: "google", callbackURL: "/" })
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                <path
                  d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                  fill="currentColor"
                />
              </svg>
              Continue with Google
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  );
}
