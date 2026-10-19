import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { Bell, BellDot, LogOut, Menu, Settings } from "lucide-react";
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
  "flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none disabled:pointer-events-none disabled:opacity-50";

const SECTION_LINK_CLASSNAME =
  "body-sm shrink-0 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-foreground aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-4";

function initialsFor(user: SessionUser): string {
  const words = user.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const initials =
    `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`.toUpperCase();
  if (initials) return initials;
  return Array.from(user.email)[0]?.toUpperCase() || "?";
}

/**
 * The longest matching section wins, so `/venues/availability` marks the calendar and not the
 * venue index, and `/venues/7` or `/venues/new` still marks the index.
 */
const ACTIVE_TARGETS = [
  "/venues/layouts",
  "/venues/availability",
  "/event-requests",
  "/coordination",
  "/venue-bookings",
  "/venue-holds",
  "/safety-reviews",
  "/venues",
  "/dashboard",
] as const;

function activeDestination(pathname: string): string | null {
  for (const to of ACTIVE_TARGETS) {
    if (pathname === to || pathname.startsWith(`${to}/`)) return to;
  }
  return null;
}

export function Header() {
  // PTR-73: Route context supplies the user. `__root.tsx` fills it during SSR, so server markup and the first client render match.
  // The old client-side `useSession()` did not keep them in sync.
  const { user, unreadNotifications } = useRouteContext({ from: "__root__" });

  // PTR-71: Sign-out is a mutation, so React tracks it. Keep the redirect in the success path.
  // If sign-out fails, show the action error. The nav then reflects the open session.
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
  const active = activeDestination(pathname);
  const showEventRequests = can(role, { event_request: ["create"] });
  // PTR-144: the Lead reaches the unassigned queue, the Coordinator their assignments.
  const showCoordination =
    can(role, { event_request: ["coordinate"] }) || can(role, { event_request: ["oversee"] });
  const showVenues = can(role, { venue: ["read"] });
  // PTR-161: Venue Staff maintain the room layout list.
  const showRoomLayouts = can(role, { venue: ["update"] });
  const showApprovedBookings = can(role, { venue_request: ["decide"] });
  const showSafetyReviews = can(role, { safety_review: ["read"] });
  const showEquipmentCatalogue = can(role, { equipment_request: ["arrange"] });
  const showSections =
    showEventRequests ||
    showCoordination ||
    showVenues ||
    showApprovedBookings ||
    showSafetyReviews ||
    showEquipmentCatalogue;

  const destinations = [
    { to: "/dashboard", label: "Dashboard", show: true },
    { to: "/event-requests", label: "Event requests", show: showEventRequests },
    { to: "/coordination", label: "Coordination", show: showCoordination },
    { to: "/venues", label: "Venues", show: showVenues },
    { to: "/venues/availability", label: "Venue calendar", show: showVenues },
    { to: "/venues/layouts", label: "Room layouts", show: showRoomLayouts },
    { to: "/venue-bookings", label: "Approved bookings", show: showApprovedBookings },
    { to: "/venue-holds", label: "Hold requests", show: showApprovedBookings },
    { to: "/safety-reviews", label: "Safety reviews", show: showSafetyReviews },
  ].filter(destination => destination.show);

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="flex h-13 items-center justify-between px-4">
        <div className="flex items-center gap-5">
          <Link to="/" className="transition-opacity hover:opacity-60">
            <img src="/favicon.svg" alt="ConnectSphere" className="size-7" />
          </Link>

          {user && (
            <Link
              to="/dashboard"
              aria-current={active === "/dashboard" ? "page" : undefined}
              className={`${SECTION_LINK_CLASSNAME} hidden md:block`}
            >
              Dashboard
            </Link>
          )}
        </div>

        {showSections && (
          <nav
            aria-label="Primary"
            className="hidden min-w-0 flex-1 items-center gap-4 overflow-x-auto px-2 md:flex"
          >
            {showEventRequests && (
              <Link
                to="/event-requests"
                aria-current={active === "/event-requests" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Event requests
              </Link>
            )}
            {showCoordination && (
              <Link
                to="/coordination"
                aria-current={active === "/coordination" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Coordination
              </Link>
            )}
            {showVenues && (
              <Link
                to="/venues"
                aria-current={active === "/venues" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Venues
              </Link>
            )}
            {showVenues && (
              <Link
                to="/venues/availability"
                aria-current={active === "/venues/availability" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Venue calendar
              </Link>
            )}
            {showRoomLayouts && (
              <Link
                to="/venues/layouts"
                aria-current={active === "/venues/layouts" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Room layouts
              </Link>
            )}
            {showApprovedBookings && (
              <Link
                to="/venue-bookings"
                aria-current={active === "/venue-bookings" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Approved bookings
              </Link>
            )}
            {showApprovedBookings && (
              <Link
                to="/venue-holds"
                aria-current={active === "/venue-holds" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Hold requests
              </Link>
            )}
            {showSafetyReviews && (
              <Link
                to="/safety-reviews"
                aria-current={active === "/safety-reviews" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Safety reviews
              </Link>
            )}
            {showEquipmentCatalogue && (
              <Link
                to="/equipment-types"
                aria-current={pathname === "/equipment-types" ? "page" : undefined}
                className={SECTION_LINK_CLASSNAME}
              >
                Equipment catalogue
              </Link>
            )}
          </nav>
        )}

        <div className="flex items-center gap-1">
          {user && (
            <nav aria-label="Menu" className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Menu"
                      title="Menu"
                      className="flex size-11 items-center justify-center"
                    />
                  }
                >
                  <Menu size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {destinations.map(destination => {
                    const current = active === destination.to;
                    return (
                      <DropdownMenuItem
                        key={destination.to}
                        render={
                          <Link to={destination.to} aria-current={current ? "page" : undefined} />
                        }
                      >
                        {current ? (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-foreground"
                          />
                        ) : null}
                        {destination.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          )}
          <nav className="flex items-center gap-1" aria-label="Account">
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
                      className="flex size-11 items-center justify-center"
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
      </div>
    </header>
  );
}
