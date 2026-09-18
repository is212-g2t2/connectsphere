import { Link } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import { buttonVariants } from "#/components/ui/button";

export function LandingPage() {
  return (
    <Page width="page" className="py-20 md:py-28">
      <section className="animate-in fade-in text-foreground duration-700">
        <h1 className="max-w-2xl text-balance hero text-foreground">ConnectSphere</h1>

        <p className="mt-6 max-w-xl body-md text-muted-foreground">
          Event planning and venue booking for organisers, coordinators, venue staff and technical
          support.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
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
    </Page>
  );
}
