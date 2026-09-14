import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueIdInput } from "#/features/venues/schema";
import { getVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/$venueId")({
  head: () => createSeoHead({ title: "Venue — ConnectSphere", noindex: true }),
  // Kept as a string like `reset-password.tsx` does: a hand-typed `?saved=abc` should not
  // drop a cosmetic banner into the route's error boundary.
  validateSearch: z.object({ saved: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }): Promise<Venue> => {
    // `VenueIdInput` already encodes "whole number, positive, within int4"; re-deriving that
    // rule here is how the two drift apart. `Number("abc")` is NaN and `Number("")` is 0, both
    // of which it refuses, so a junk path segment is a 404 without ever hitting the server.
    const parsed = VenueIdInput.safeParse({ id: Number(params.venueId) });
    if (!parsed.success) {
      throw notFound();
    }
    const { venue } = await unwrapRefusal(
      await getVenue({ data: parsed.data }),
      "Could not load this venue. Try again."
    );
    if (!venue) {
      throw notFound();
    }
    return venue;
  },
  component: () => (
    <VenueDetailPage
      venue={Route.useLoaderData()}
      user={Route.useRouteContext().user}
      justCreated={Route.useSearch().saved === "true"}
    />
  ),
});
