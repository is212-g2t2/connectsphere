import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ResetPasswordPage } from "#/features/auth/components/reset-password-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/reset-password")({
  head: () => createSeoHead({ title: "Reset Password — ConnectSphere", noindex: true }),
  // Keep these as strings. The form explains hand-typed `?token=` or `?error=` values; the route should not reject them.
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  component: () => <ResetPasswordPage {...Route.useSearch()} />,
});
