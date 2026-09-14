import { ResetPasswordForm } from "#/features/auth/components/reset-password-form";

/**
 * The reset page, in both of its states: requesting a link, or setting a new password with the
 * `?token=` the email carries. The route validates the search params and passes them down.
 */
export function ResetPasswordPage({ token, error }: { token?: string; error?: string }) {
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ResetPasswordForm token={token} error={error} />
    </div>
  );
}
