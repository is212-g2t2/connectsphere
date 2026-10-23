import { Link } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import { buttonVariants } from "#/components/ui/button";

const CAPABILITIES = [
  {
    title: "Request an event",
    description:
      "Organisers describe the event once. Coordinators review it, and every decision stays on the record.",
  },
  {
    title: "Find a venue",
    description:
      "Search rooms against the event's requirements and check live availability before you commit.",
  },
  {
    title: "Stay coordinated",
    description:
      "Approvals, equipment, and safety reviews move in one trail, so nothing waits on a hallway chat.",
  },
];

/**
 * The public entry: one outcome headline, one gradient moment, three capabilities, one primary
 * action. Sign-up offers Attendee and Event organiser only; every other staff account is
 * provisioned by an administrator.
 */
export function LandingPage() {
  return (
    <Page width="page" className="py-20 md:py-28">
      <section className="animate-in fade-in duration-700">
        <p className="eyebrow text-muted-foreground">ConnectSphere</p>
        <h1 className="mt-4 max-w-2xl text-balance hero text-foreground">
          Plan events and{" "}
          <span className="cover-art bg-clip-text text-transparent">book venues</span> in one place
        </h1>

        <p className="mt-6 max-w-xl body-md text-muted-foreground">
          Event planning and venue booking for organisers, coordinators, venue staff and technical
          support. Create an account as an attendee or an event organiser. Staff accounts are
          provisioned by an administrator.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link to="/signup" className={buttonVariants({ size: "lg" })}>
            Create an account
          </Link>
          <Link
            to="/login"
            className={buttonVariants({
              variant: "ghost",
              size: "lg",
            })}
          >
            Sign in
          </Link>
        </div>
      </section>

      <section aria-label="Capabilities" className="mt-20 md:mt-28">
        <div className="grid gap-4 sm:grid-cols-3">
          {CAPABILITIES.map(capability => (
            <div
              key={capability.title}
              className="rounded-xl border border-border bg-card p-6 shadow-card"
            >
              <h2 className="display-h3">{capability.title}</h2>
              <p className="mt-2 body-sm text-muted-foreground">{capability.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-20 border-t border-border pt-6 md:mt-28">
        <p className="caption text-muted-foreground">
          ConnectSphere — plan events, book venues, stay coordinated.
        </p>
      </footer>
    </Page>
  );
}
