import { Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "#/lib/auth-client";
import { Button } from "#/components/ui/button";
import { ThemeToggle } from "../ui/theme-toggle";

export function Header() {
  // PTR-73: the user comes from route context, which `__root.tsx` fills during SSR — so the
  // server markup and the first client render agree, unlike the old client-side `useSession()`.
  const { user } = useRouteContext({ from: "__root__" });
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/";
        },
      },
    });
    setSigningOut(false);
  };

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
              Sign out
            </Button>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
