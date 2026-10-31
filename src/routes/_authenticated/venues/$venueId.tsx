import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { can } from "#/features/auth/permissions";
import { VenueRequestIdInput, VenueRequestContextInput } from "#/features/venue-requests/schema";
import { getVenueRequestContext } from "#/features/venue-requests/server-fns";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueDetailPageSkeleton } from "#/features/venues/components/venue-detail-page-skeleton";
import { TIME_SHAPE, VENUE_SEARCH_TEXT_MAX_LENGTH, VenueIdInput } from "#/features/venues/schema";
import { getVenue, listRoomLayouts } from "#/features/venues/server-fns";
import type { RoomLayout } from "#/features/venues/schema";
import type { VenueWithConflicts } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/$venueId")({
  head: () => createSeoHead({ title: "Venue — ConnectSphere", noindex: true }),
  validateSearch: z.object({
    // Keep `saved` as a string, as in `reset-password.tsx`. A hand-typed `?saved=abc` must not
    // cause a route error.
    saved: z.string().optional(),
    // `eventId` supplies PTR-31 context when the venue search includes it. The router converts
    // `?eventId=12` to a number, so the schema coerces it. Treat failed coercion as no context.
    eventId: z.coerce.number().int().positive().optional().catch(undefined),
    // The window and the session requirements prefill the request form from the venue search or
    // the rejection card (PTR-35, PTR-138 AC1). Drop hand-typed values that are not a civil date,
    // `HH:MM`, a positive attendance, or text within the search's length.
    date: z.iso.date().optional().catch(undefined),
    startTime: z.string().regex(TIME_SHAPE).optional().catch(undefined),
    endTime: z.string().regex(TIME_SHAPE).optional().catch(undefined),
    expectedAttendance: z.coerce.number().pipe(z.int32().positive()).optional().catch(undefined),
    layout: z.string().max(VENUE_SEARCH_TEXT_MAX_LENGTH).optional().catch(undefined),
    accessibilityRequirements: z
      .string()
      .max(VENUE_SEARCH_TEXT_MAX_LENGTH)
      .optional()
      .catch(undefined),
    requiredFacilities: z.string().max(VENUE_SEARCH_TEXT_MAX_LENGTH).optional().catch(undefined),
    // PTR-165 AC1: the rejected request that an adjusted request replaces. It uses the same
    // text-id rule as every request id.
    replacesRequestId: VenueRequestIdInput.shape.id.optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // Only `eventId` reruns the loader. The component reads `saved` and the prefill values, so they do not reload data.
  // The loader context carries only params, so `eventId` arrives as `deps`.
  loaderDeps: ({ search }) => ({ eventId: search.eventId }),
  loader: async ({
    params,
    deps,
    context,
  }): Promise<{
    venue: VenueWithConflicts;
    layouts: readonly RoomLayout[];
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

    const [venueResult, layouts, contextResult] = await Promise.all([
      getVenue({ data: parsed.data }),
      listRoomLayouts(),
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
      layouts,
      requestContext: contextResult?.context ?? null,
      requestContextFailed: contextResult?.failed ?? false,
    };
  },
  component: () => {
    const { venue, layouts, requestContext, requestContextFailed } = Route.useLoaderData();
    const { saved, eventId, ...prefill } = Route.useSearch();
    return (
      <VenueDetailPage
        venue={venue}
        layouts={layouts}
        requestContext={requestContext}
        requestContextFailed={requestContextFailed}
        user={Route.useRouteContext().user}
        justCreated={saved === "true"}
        eventId={eventId}
        prefill={prefill}
      />
    );
  },
  pendingComponent: VenueDetailPageSkeleton,
});
