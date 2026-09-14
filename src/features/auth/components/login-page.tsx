import { LoginForm } from "#/features/auth/components/login-form";

/** The sign-in page: the form on the narrow auth column every auth route shares. */
export function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <LoginForm />
    </div>
  );
}
