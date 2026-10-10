import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { Bell, BellDot, LogOut, Settings } from "lucide-react";
import { toast } from "sonner";

import type { SessionUser } from "#/features/auth/session";
import { can } from "#/features/auth/permissions";
import { useMutation } from "#/hooks/use-mutation";
import { authClient } from "#/lib/auth-client";
import { Avatar, AvatarFallback } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ThemeToggle } from "../ui/theme-toggle";

const SIGN_OUT_FAILED = "Could not sign out. Try again.";

const ICON_LINK_CLASSNAME =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none disabled:pointer-events-none disabled:opacity-50";

const SECTION_LINK_CLASSNAME =
  "body-sm shrink-0 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground";

function initialsFor(user: SessionUser): string {
  const words = user.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials =
    `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`.toUpperCase();
  if (initials) return initials;
  return Array.from(user.email)[0]?.toUpperCase() || "?";
}

export function Header() {
  // PTR-73: the user comes from route context, which `__root.tsx` fills during SSR — so the
  // server markup and the first client render agree, unlike the old client-side `useSession()`.
  const { user, unreadNotifications } = useRouteContext({ from: "__root__" });

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

  const unread = unreadNotifications > 0;

  const role = user?.role ?? null;
  const { pathname } = useLocation();
  const showEventRequests = can(role, { event_request: ["create"] });
  const showCoordination = can(role, { event_request: ["coordinate"] });
  const showVenues = can(role, { venue: ["read"] });
  const showApprovedBookings = can(role, { venue_request: ["decide"] });
  const showSections = showEventRequests || showCoordination || showVenues || showApprovedBookings;

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="flex h-13 items-center justify-between px-4">
        <Link to="/" className="transition-opacity hover:opacity-60">
          <img src="/favicon.svg" alt="ConnectSphere" className="size-7" />
        </Link>

        {showSections && (
          <nav
            aria-label="Primary"
            className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto px-2"
          >
            {showEventRequests && (
              <Link
                to="/event-requests"
                aria-current={pathname === "/event-requests" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Event requests
              </Link>
            )}
            {showCoordination && (
              <Link
                to="/coordination"
                aria-current={pathname === "/coordination" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Coordination
              </Link>
            )}
            {showVenues && (
              <Link
                to="/venues"
                aria-current={pathname === "/venues" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Venues
              </Link>
            )}
            {showVenues && (
              <Link
                to="/venues/availability"
                aria-current={pathname === "/venues/availability" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Venue calendar
              </Link>
            )}
            {showApprovedBookings && (
              <Link
                to="/venue-bookings"
                aria-current={pathname === "/venue-bookings" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Approved bookings
              </Link>
            )}
          </nav>
        )}

        <nav className="flex items-center gap-1">
          {user && (
            <Link
              to="/notifications"
              aria-label={unread ? "Notifications, unread" : "Notifications"}
              title={unread ? "Notifications, unread" : "Notifications"}
              className={ICON_LINK_CLASSNAME}
            >
              {unread ? <BellDot size={16} /> : <Bell size={16} />}
            </Link>
          )}
          <ThemeToggle />
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Account menu"
                    title="Account menu"
                    className={ICON_LINK_CLASSNAME}
                  />
                }
              >
                <Avatar size="default">
                  <AvatarFallback>{initialsFor(user)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link to="/settings" />}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                >
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>
      </div>
    </header>
  );
}
