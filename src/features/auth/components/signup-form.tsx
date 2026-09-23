import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";
import { PasswordSchema } from "#/features/auth/schema/password";
import { DEFAULT_ROLE, SelfAssignableRoleSchema } from "#/features/auth/schema/role";
import { useState } from "react";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter your name")
      .max(100, "Name must be at most 100 characters"),
    email: z.email("Enter a valid email address"),
    password: PasswordSchema,
    // Deliberately unconstrained on its own: the policy belongs to `password`, and running
    // PasswordSchema here too would bury the mismatch error under duplicate policy errors.
    confirmPassword: z.string(),
    role: SelfAssignableRoleSchema,
  })
  .refine(value => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    error: "Passwords do not match",
  });

/** Also feeds the Select trigger, which resolves a selected value to its label through `items`. */
const ROLE_LABELS: Record<string, string> = {
  attendee: "Attendee",
  event_organiser: "Event Organiser",
};

export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
  const navigate = useNavigate();
  const router = useRouter();
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirmPassword: "", role: DEFAULT_ROLE },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.signUp.email({
        name: value.name.trim(),
        email: value.email,
        password: value.password,
        role: value.role,
      });
      if (error) {
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error.message ?? "Could not create your account. Try again.",
          },
        });
        return;
      }
      setVerifyEmail(value.email);
      // Signing up creates the session in place — this panel replaces the form, no navigation —
      // so the route context the header reads (PTR-73) is still the signed-out one this page was
      // served with. Re-resolving it is what puts "Sign out" in the nav.
      await router.invalidate();
    },
  });

  if (verifyEmail) {
    return (
      <div className={cn("flex flex-col gap-5", className)} {...props}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="display-h1">Check your email</h1>
            <FieldDescription>
              We sent a verification link to <strong>{verifyEmail}</strong>. Please verify your
              email address to complete your registration.
            </FieldDescription>
          </div>
          <Field>
            <Button type="button" onClick={() => void navigate({ to: "/dashboard" })}>
              Continue
            </Button>
          </Field>
        </FieldGroup>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-5", className)} {...props}>
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="display-h1">Create an account</h1>
            <FieldDescription>
              Already have an account? <Link to="/login">Sign in</Link>
            </FieldDescription>
          </div>

          <form.Field name="name">
            {field => (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="email">
            {field => (
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
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
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
                <FieldDescription>
                  At least 8 characters, including a number and a symbol.
                </FieldDescription>
              </Field>
            )}
          </form.Field>

          <form.Field name="confirmPassword">
            {field => (
              <Field>
                <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="role">
            {field => (
              <Field>
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <Select
                  items={ROLE_LABELS}
                  value={field.state.value}
                  onValueChange={value =>
                    field.handleChange(SelfAssignableRoleSchema.catch(DEFAULT_ROLE).parse(value))
                  }
                >
                  <SelectTrigger
                    id="role"
                    className="w-full"
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attendee">Attendee</SelectItem>
                    <SelectItem value="event_organiser">Event Organiser</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Select your account role</FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={state => state.errorMap.onSubmit}>
            {/* A failed validation arrives as an issue map; only a refused sign-up is a string. */}
            {onSubmitError =>
              typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
            }
          </form.Subscribe>

          <form.Subscribe selector={s => s.isSubmitting}>
            {isSubmitting => (
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating account..." : "Create account"}
                </Button>
              </Field>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </div>
  );
}
