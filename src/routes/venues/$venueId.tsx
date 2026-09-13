import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { getCurrentUser } from "#/features/auth/session";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import { VenueIdInput } from "#/features/venues/schema";
import { getVenue, saveVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

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
    // `VenueIdInput` already encodes "whole number, positive, within int4"; re-deriving that
    // rule here is how the two drift apart. `Number("abc")` is NaN and `Number("")` is 0, both
    // of which it refuses, so a junk path segment is a 404 without ever hitting the server.
    const parsed = VenueIdInput.safeParse({ id: Number(params.venueId) });
    if (!parsed.success) {
      throw notFound();
    }
    const result = await getVenue({ data: parsed.data });
    if (result instanceof Response) {
      throw new Error((await result.text()) || "Could not load this venue. Try again.");
    }
    const { venue } = result;
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
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [saved, setSaved] = useState(justCreated === "true");
  const canUpdate = can(user.role, { venue: ["update"] });

  // The confirmation is seeded from `?saved=true` once, above, and then the param is stripped:
  // a search param is part of the URL, so F5 would re-evaluate it and re-announce a save that
  // never happened. `replace` rather than a push so Back still leads out of this page rather
  // than to the same page with the param restored.
  useEffect(() => {
    if (justCreated === "true") {
      void navigate({ search: {}, replace: true });
    }
  }, [justCreated, navigate]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/venues" className={NAV_LINK_CLASSNAME}>
        Back to venues
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">{venue.name}</h1>
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
            // Remounting is what resets the inputs to the stored values (trimmed,
            // de-duplicated) rather than what was typed, so the key is the row's identity:
            // `updatedAt` is the part that changes on a save, and `venue.id` only guards a
            // venue-to-venue navigation, which the route sets no `remountDeps` for and which
            // nothing links to today. `initial` is loader-derived either way.
            key={`${venue.id}-${venue.updatedAt.toString()}`}
            initial={venue}
            onSave={async values => {
              // Dropped and re-raised around the save rather than just set: `<output>` is an
              // implicit live region, and re-announcing a repeat save needs the node to go
              // away and come back, not merely to hold the same words.
              setSaved(false);
              const result = await saveVenue({ data: { ...values, id: venue.id } });
              if (result instanceof Response) {
                throw new Error((await result.text()) || "Could not save this venue. Try again.");
              }
              // The loader is the only source for the row. Invalidating re-runs it, which
              // replaces `venue` with the saved values and bumps `updatedAt` (the column is
              // `$onUpdate`), so the key above changes and the banner arrives together with
              // the reloaded values. Keeping a local copy of the response instead would let
              // component state and loader data drift apart.
              await router.invalidate();
              setSaved(true);
            }}
          />
        ) : (
          <VenueDetails venue={venue} />
        )}
      </div>
    </main>
  );
}
