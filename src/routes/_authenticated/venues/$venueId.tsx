import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { VenueRequestContextInput } from "#/features/venue-requests/schema";
import { getVenueRequestContext } from "#/features/venue-requests/server-fns";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueDetailPageSkeleton } from "#/features/venues/components/venue-detail-page-skeleton";
import { TIME_SHAPE, VenueIdInput } from "#/features/venues/schema";
import { getVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/$venueId")({
  head: () => createSeoHead({ title: "Venue — ConnectSphere", noindex: true }),
  // Keep `saved` as a string, as in `reset-password.tsx`. A hand-typed `?saved=abc` must not cause a route error.
  // `eventId` supplies PTR-31 context when the venue search includes it. The router converts
  // `?eventId=12` to a number, so the schema coerces it. Treat failed coercion as no context.
  // `date`, `startTime`, and `endTime` prefill an adjusted request from the rejection card.
  // Drop hand-typed values that are not a civil date or `HH:MM`.
  validateSearch: z.object({
    saved: z.string().optional(),
    eventId: z.coerce.number().int().positive().optional().catch(undefined),
    date: z.iso.date().optional().catch(undefined),
    startTime: z.string().regex(TIME_SHAPE).optional().catch(undefined),
    endTime: z.string().regex(TIME_SHAPE).optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // Only `eventId` reruns the loader. The component reads `saved` and the prefill window, so they do not reload data.
  // The loader context carries only params, so `eventId` arrives as `deps`.
  loaderDeps: ({ search }) => ({ eventId: search.eventId }),
  loader: async ({
    params,
    deps,
    context,
  }): Promise<{
    venue: Venue;
    requestContext: VenueRequestContext | null;
    requestContextFailed: boolean;
  }> => {
    // Use `VenueIdInput` to keep the path under the same positive int4 rule as other venue IDs.
    // `Number("abc")` gives NaN and `Number("")` gives 0; both fail before the server call.
    // A malformed path segment therefore returns 404 without a server round trip.
    const parsed = VenueIdInput.safeParse({ id: Number(params.venueId) });
    if (!parsed.success) {
      throw notFound();
    }

    // Load request context only for roles that can act and when the search has a complete selection.
    // `safeParse(...).data ?? null` treats an edited or incomplete `eventId` as no context.
    // The handler returns `null` for a foreign event, so the venue page still renders.
    const selection = can(context.user.role, { venue_request: ["request"] })
      ? (VenueRequestContextInput.safeParse({
          eventId: deps.eventId,
          venueId: parsed.data.id,
        }).data ?? null)
      : null;

    const [venueResult, contextResult] = await Promise.all([
      getVenue({ data: parsed.data }),
      // Request context is optional. Keep the venue page available if the context load fails.
      // Set a retryable error flag; do not use the `null` value for a venue opened without an event.
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
    const search = Route.useSearch();
    return (
      <VenueDetailPage
        venue={venue}
        requestContext={requestContext}
        requestContextFailed={requestContextFailed}
        user={Route.useRouteContext().user}
        justCreated={search.saved === "true"}
        prefill={
          search.date && search.startTime && search.endTime
            ? { date: search.date, startTime: search.startTime, endTime: search.endTime }
            : null
        }
      />
    );
  },
  pendingComponent: VenueDetailPageSkeleton,
});
