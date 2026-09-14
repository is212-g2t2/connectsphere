import { Link, useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { useMutation } from "#/hooks/use-mutation";
import { authClient } from "#/lib/auth-client";
import { Button } from "#/components/ui/button";
import { ThemeToggle } from "../ui/theme-toggle";

const SIGN_OUT_FAILED = "Could not sign out. Try again.";

export function Header() {
  // PTR-73: the user comes from route context, which `__root.tsx` fills during SSR — so the
  // server markup and the first client render agree, unlike the old client-side `useSession()`.
  const { user } = useRouteContext({ from: "__root__" });

  // PTR-71: signing out is a mutation, so React holds its in-flight flag. The redirect is the
  // success path and stays inside the action; a refused sign-out lands in the action's error
  // state rather than leaving the nav pointing at a session that is still open.
  const [, signOut, signingOut] = useMutation(async () => {
    const { error } = await authClient.signOut();
    if (error) {
      throw new Error(error.message ?? SIGN_OUT_FAILED);
    }

    window.location.href = "/";
  }, SIGN_OUT_FAILED);

  async function handleSignOut() {
    const { error } = await signOut();
    if (error) {
      toast.error(error);
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
        <Link to="/" className="transition-opacity hover:opacity-60">
          <img src="/favicon.svg" alt="ConnectSphere" className="size-7" />
        </Link>

        <nav className="flex items-center gap-1">
          {user && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
