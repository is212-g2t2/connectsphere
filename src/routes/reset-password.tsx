import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResetPasswordForm } from "#/features/auth/components/reset-password-form";
import { createSeoHead } from "#/lib/seo";

const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20 md:py-28">
      <ResetPasswordForm token={token} error={error} />
    </div>
  );
}

export const Route = createFileRoute("/reset-password")({
  head: () =>
    createSeoHead({
      title: "Reset Password — TanStack Start Template",
      noindex: true,
    }),
  validateSearch: searchSchema,
  component: ResetPasswordPage,
});
