import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ResetPasswordPage } from "#/features/auth/components/reset-password-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/reset-password")({
  head: () => createSeoHead({ title: "Reset Password — ConnectSphere", noindex: true }),
  // Kept as strings: a hand-typed `?token=` or `?error=` is for the form to explain, not for the
  // route's error boundary to refuse.
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  component: () => <ResetPasswordPage {...Route.useSearch()} />,
});
