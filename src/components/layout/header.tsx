import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "#/lib/auth-client";
import { Button } from "#/components/ui/button";
import { ThemeToggle } from "../ui/theme-toggle";

export function Header() {
  const { data: session } = authClient.useSession();
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
        <Link
          to="/"
          className="font-mono text-sm font-medium tracking-tight transition-opacity hover:opacity-60"
        >
          tanstack-start
        </Link>

        <nav className="flex items-center gap-1">
          <a
            href="https://github.com/zek01svg/tanstack-start-template"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          {session?.user && (
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
