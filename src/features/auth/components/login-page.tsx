import { AuthShell } from "#/features/auth/components/auth-shell";
import { LoginForm } from "#/features/auth/components/login-form";

/** The sign-in page: the form on the auth card in the 880px column every auth route shares. */
export function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
