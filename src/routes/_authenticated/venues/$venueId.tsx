import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { VenueRequestContextInput } from "#/features/venue-requests/schema";
import { getVenueRequestContext } from "#/features/venue-requests/server-fns";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueDetailPageSkeleton } from "#/features/venues/components/venue-detail-page-skeleton";
import { VenueIdInput } from "#/features/venues/schema";
import { getVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/$venueId")({
  head: () => createSeoHead({ title: "Venue — ConnectSphere", noindex: true }),
  // Kept as a string like `reset-password.tsx` does: a hand-typed `?saved=abc` should not
  // drop a cosmetic banner into the route's error boundary. `eventId` is PTR-31's context — the
  // event the visitor came from, if the venue search carried it in. The router's search codec
  // turns `?eventId=12` into a number, so the schema coerces, and `catch` keeps a hand-typed
  // `?eventId=abc` as "no context" rather than a route error.
  validateSearch: z.object({
    saved: z.string().optional(),
    eventId: z.coerce.number().int().positive().optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // The search is a loader dependency so `eventId` re-runs the loader when it changes; the
  // loader context itself carries only params, so the value arrives as `deps`.
  loaderDeps: ({ search }) => search,
  loader: async ({
    params,
    deps,
    context,
  }): Promise<{
    venue: Venue;
    requestContext: VenueRequestContext | null;
    requestContextFailed: boolean;
  }> => {
    // `VenueIdInput` already encodes "whole number, positive, within int4"; re-deriving that
    // rule here is how the two drift apart. `Number("abc")` is NaN and `Number("")` is 0, both
    // of which it refuses, so a junk path segment is a 404 without ever hitting the server.
    const parsed = VenueIdInput.safeParse({ id: Number(params.venueId) });
    if (!parsed.success) {
      throw notFound();
    }

    // The request context is only asked for by roles that can act on it, and only when the
    // search carried a complete selection. `safeParse(...).data ?? null` keeps a hand-edited or
    // incomplete `eventId` as "no context", and a foreign one answers `null` inside the handler,
    // so the page still renders the venue either way.
    const selection = can(context.user.role, { venue_request: ["request"] })
      ? (VenueRequestContextInput.safeParse({
          eventId: deps.eventId,
          venueId: parsed.data.id,
        }).data ?? null)
      : null;

    const [venueResult, contextResult] = await Promise.all([
      getVenue({ data: parsed.data }),
      // The request panel is an optional overlay on the venue record: a failed context load must
      // not take the venue down with it. It becomes a flag the page can report and retry, rather
      // than the same `null` as "this venue was opened without an event".
      selection
        ? getVenueRequestContext({ data: selection })
            .then(result => ({ context: result.context, failed: false }))
            .catch(() => ({ context: null, failed: true }))
        : null,
    ]);

    if (!venueResult.venue) {
      throw notFound();
    }

    return {
      venue: venueResult.venue,
      requestContext: contextResult?.context ?? null,
      requestContextFailed: contextResult?.failed ?? false,
    };
  },
  component: () => {
    const { venue, requestContext, requestContextFailed } = Route.useLoaderData();
    return (
      <VenueDetailPage
        venue={venue}
        requestContext={requestContext}
        requestContextFailed={requestContextFailed}
        user={Route.useRouteContext().user}
        justCreated={Route.useSearch().saved === "true"}
      />
    );
  },
  pendingComponent: VenueDetailPageSkeleton,
});
