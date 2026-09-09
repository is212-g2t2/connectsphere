import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";
import { useState } from "react";

const schema = z.object({
  otp: z.string().length(6, "Enter the 6-digit code").regex(/^\d+$/, "Code must be digits only"),
});

interface VerifyOtpFormProps extends Omit<React.ComponentProps<"div">, "children"> {
  email: string;
  flow: "sign-in" | "sign-up";
}

export function VerifyOtpForm({ email, flow, className, ...props }: VerifyOtpFormProps) {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPasskeyPrompt, setShowPasskeyPrompt] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { otp: "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp: value.otp,
      });
      if (error) {
        setServerError(error.message ?? "Invalid or expired code. Try again.");
        return;
      }
      if (flow === "sign-up") {
        setShowPasskeyPrompt(true);
      } else {
        await navigate({ to: "/" });
      }
    },
  });

  if (showPasskeyPrompt) {
    return (
      <PasskeyPrompt
        email={email}
        error={passkeyError}
        onRegister={async () => {
          setPasskeyError(null);
          const result = await authClient.passkey.addPasskey({ name: email });
          if (result.error) {
            setPasskeyError(result.error.message ?? "Failed to set up passkey.");
            return;
          }
          await navigate({ to: "/" });
        }}
        onSkip={() => void navigate({ to: "/" })}
      />
    );
  }

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
            <h1 className="font-heading text-2xl font-bold tracking-tight">Check your email</h1>
            <FieldDescription>
              We sent a 6-digit code to <strong>{email}</strong>
            </FieldDescription>
          </div>

          <form.Field name="otp">
            {field => (
              <Field>
                <FieldLabel htmlFor="otp">Verification code</FieldLabel>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={field.state.value}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    field.handleChange(digits);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                  className="text-center tracking-widest text-lg"
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          {serverError && <FieldError>{serverError}</FieldError>}

          <form.Subscribe selector={s => s.isSubmitting}>
            {isSubmitting => (
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Verifying..." : "Verify code"}
                </Button>
              </Field>
            )}
          </form.Subscribe>

          <FieldDescription className="text-center">
            Wrong email? <Link to={flow === "sign-up" ? "/signup" : "/login"}>Go back</Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}

function PasskeyPrompt({
  email,
  error,
  onRegister,
  onSkip,
}: {
  email: string;
  error: string | null;
  onRegister: () => Promise<void>;
  onSkip: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    await onRegister();
    setLoading(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup className="gap-5">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Set up a passkey</h1>
          <FieldDescription>
            Use your device biometrics or PIN to sign in faster next time. No password needed.
          </FieldDescription>
        </div>

        {error && <FieldError>{error}</FieldError>}

        <Field>
          <Button type="button" disabled={loading} onClick={() => void handleRegister()}>
            {loading ? "Setting up..." : "Set up passkey"}
          </Button>
        </Field>

        <Field>
          <Button variant="ghost" type="button" onClick={onSkip}>
            Skip for now
          </Button>
        </Field>

        <FieldDescription className="text-center text-xs">
          Signed in as <strong>{email}</strong>
        </FieldDescription>
      </FieldGroup>
    </div>
  );
}
