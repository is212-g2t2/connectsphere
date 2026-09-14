import { SignupForm } from "#/features/auth/components/signup-form";

/** The registration page: the form on the narrow auth column every auth route shares. */
export function SignupPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <SignupForm />
    </div>
  );
}
