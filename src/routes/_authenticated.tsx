import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  /**
   * `__root.tsx` already resolved the session for this load (PTR-73), so this boundary only refuses access.
   * Re-emit context with a non-null `SessionUser`. Routes can then read `context.user` without repeating the check.
   */
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: "/login" });
    }

    return { user: context.user };
  },
});
