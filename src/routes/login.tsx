import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginPage } from "#/features/auth/components/login-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => createSeoHead({ title: "Sign In — ConnectSphere", noindex: true }),
  // The session `__root.tsx` already resolved (PTR-73) — asking the server again here would
  // spend a second roundtrip on the same navigation.
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LoginPage,
});
