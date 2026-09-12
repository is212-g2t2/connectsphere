import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { assertNotRefused, getCurrentUser } from "#/features/auth/session";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import { getVenue, saveVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

const NAV_LINK =
  "text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground";

export const Route = createFileRoute("/venues/$venueId")({
  head: () =>
    createSeoHead({
      title: "Venue — ConnectSphere",
      noindex: true,
    }),
  // Kept as a string like `reset-password.tsx` does: a hand-typed `?saved=abc` should not
  // drop a cosmetic banner into the route's error boundary.
  validateSearch: z.object({ saved: z.string().optional() }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    if (!can(user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }

    return { user };
  },
  loader: async ({ params }): Promise<Venue> => {
    const id = Number(params.venueId);
    const { venue } =
      Number.isInteger(id) && id > 0
        ? assertNotRefused(await getVenue({ data: { id } }))
        : { venue: null };
    if (!venue) {
      throw notFound();
    }
    return venue;
  },
  component: VenuePage,
});

function VenuePage() {
  const { user } = Route.useRouteContext();
  const venue = Route.useLoaderData();
  const { saved: justCreated } = Route.useSearch();
  const [saved, setSaved] = useState(justCreated === "true");
  const [current, setCurrent] = useState(venue);
  const canUpdate = can(user.role, { venue: ["update"] });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/venues" className={NAV_LINK}>
        Back to venues
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">{current.name}</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        {canUpdate
          ? "Edit the record; Coordinators plan against whatever is saved here."
          : "Recorded by Venue Staff. Ask them if something here is out of date."}
      </p>

      {saved && (
        <output className="mt-6 block text-sm font-medium text-foreground">Venue saved.</output>
      )}

      <div className="mt-10">
        {canUpdate ? (
          <VenueForm
            key={current.updatedAt.toString()}
            initial={current}
            onSave={async values => {
              setSaved(false);
              const updated = assertNotRefused(
                await saveVenue({ data: { ...values, id: current.id } })
              );
              setCurrent(updated);
              setSaved(true);
            }}
          />
        ) : (
          <VenueDetails venue={current} />
        )}
      </div>
    </main>
  );
}
