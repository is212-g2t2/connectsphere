import { createFileRoute, redirect } from "@tanstack/react-router";

import { LoginPage } from "#/features/auth/components/login-page";
import { getCurrentUser } from "#/features/auth/session";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => createSeoHead({ title: "Sign In — ConnectSphere", noindex: true }),
  beforeLoad: async () => {
    if (await getCurrentUser()) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LoginPage,
});
