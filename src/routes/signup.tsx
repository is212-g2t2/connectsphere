import { createFileRoute, redirect } from "@tanstack/react-router";

import { SignupPage } from "#/features/auth/components/signup-page";
import { getCurrentUser } from "#/features/auth/session";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/signup")({
  head: () => createSeoHead({ title: "Sign Up — ConnectSphere", noindex: true }),
  beforeLoad: async () => {
    if (await getCurrentUser()) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SignupPage,
});
