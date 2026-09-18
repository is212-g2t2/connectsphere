import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { ResetPasswordForm } from "#/features/auth/components/reset-password-form";

/**
 * The reset page, in both of its states: requesting a link, or setting a new password with the
 * `?token=` the email carries. The route validates the search params and passes them down.
 */
export function ResetPasswordPage({ token, error }: { token?: string; error?: string }) {
  return (
    <Page width="page">
      <Card size="auth" className="mx-auto w-full max-w-[400px]">
        <CardContent>
          <ResetPasswordForm token={token} error={error} />
        </CardContent>
      </Card>
    </Page>
  );
}
