import { createFileRoute, redirect } from "@tanstack/react-router";

import { LandingPage } from "#/features/landing/components/landing-page";
import { createSeoHead, getStructuredData } from "#/lib/seo";

export const Route = createFileRoute("/")({
  head: () =>
    createSeoHead({
      title: "ConnectSphere — Event Planning & Venue Booking",
      description:
        "Event planning and venue booking for organisers, coordinators, venue staff and technical support.",
      path: "/",
      structuredData: getStructuredData(),
    }),
  // `__root.tsx` already resolved the session for this navigation (PTR-73). A second server call adds one round trip.
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: LandingPage,
});
