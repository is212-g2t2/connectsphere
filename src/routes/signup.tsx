import { createFileRoute, redirect } from "@tanstack/react-router";

import { SignupPage } from "#/features/auth/components/signup-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/signup")({
  head: () => createSeoHead({ title: "Sign Up — ConnectSphere", noindex: true }),
  /**
   * `__root.tsx` already resolved the session for this navigation (PTR-73). A second server call adds one round trip.
   *
   * Redirect only when a signed-in user arrives at this route. Signup creates the session without leaving the route.
   * The form then resolves context again so the header can show the user. That result has `cause: "stay"`.
   * Keep the visitor on the "Check your email" panel after signup.
   */
  beforeLoad: ({ context, cause }) => {
    if (cause === "enter" && context.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SignupPage,
});
