import { createFileRoute, redirect } from "@tanstack/react-router";

import { getCurrentUser } from "#/features/auth/session";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
});
