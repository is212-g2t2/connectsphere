import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { LoginForm } from "#/features/auth/components/login-form";

/** The sign-in page: the form on the auth card in the 880px column every auth route shares. */
export function LoginPage() {
  return (
    <Page width="page">
      <Card size="auth" className="mx-auto w-full max-w-[400px]">
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </Page>
  );
}
