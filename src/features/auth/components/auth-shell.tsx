import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";

/**
 * The shell every public auth route shares: wordmark, auth card, trust footer.
 * Keeps `Card size="auth"`; each page passes its form as the content.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <Page width="page">
      <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6">
        <Link
          to="/"
          aria-label="ConnectSphere home"
          className="flex items-center justify-center gap-2"
        >
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="label">ConnectSphere</span>
        </Link>
        <Card size="auth" className="w-full">
          <CardContent>{children}</CardContent>
        </Card>
        <p className="text-center caption text-muted-foreground">
          Need help? Contact your administrator.
        </p>
      </div>
    </Page>
  );
}
