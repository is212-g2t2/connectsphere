import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginPage } from "#/features/auth/components/login-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => createSeoHead({ title: "Sign In — ConnectSphere", noindex: true }),
  // `__root.tsx` already resolved the session for this navigation (PTR-73). A second server call adds one round trip.
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LoginPage,
});
