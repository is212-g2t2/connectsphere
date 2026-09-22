import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (error) {
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        // Never the server's own message: it must not reveal whether the email exists (PTR-6 AC2).
        formApi.setErrorMap({ onSubmit: { fields: {}, form: "Invalid email or password." } });
        return;
      }
      await navigate({ to: "/dashboard" });
    },
  });

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
            <h1 className="display-h1">Welcome back</h1>
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

          <form.Subscribe selector={state => state.errorMap.onSubmit}>
            {/* A failed validation arrives as an issue map; only a refused sign-in is a string. */}
            {onSubmitError =>
              typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
            }
          </form.Subscribe>

          <form.Subscribe selector={s => s.isSubmitting}>
            {isSubmitting => (
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </Button>
              </Field>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </div>
  );
}
