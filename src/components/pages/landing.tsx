import { Link } from "@tanstack/react-router";

import { buttonVariants } from "#/components/ui/button";

export function LandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6">
      <section className="animate-in fade-in text-foreground duration-700">
        <div className="py-20 md:py-28">
          <h1 className="mt-6 max-w-2xl text-balance text-[clamp(2.5rem,6vw,4rem)] leading-[1.1] text-foreground">
            ConnectSphere
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
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
        </div>
      </section>
    </main>
  );
}
