import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { SignupForm } from "#/features/auth/components/signup-form";

/** The registration page: the form on the auth card in the 880px column every auth route shares. */
export function SignupPage() {
  return (
    <Page width="page">
      <Card size="auth" className="mx-auto w-full max-w-[400px]">
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </Page>
  );
}
