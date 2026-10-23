import { AuthShell } from "#/features/auth/components/auth-shell";
import { SignupForm } from "#/features/auth/components/signup-form";

/** The registration page: the form on the auth card in the 880px column every auth route shares. */
export function SignupPage() {
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
