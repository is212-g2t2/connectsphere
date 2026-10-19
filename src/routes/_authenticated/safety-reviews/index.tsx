import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { SafetyReviewsPage } from "#/features/safety-reviews/components/safety-reviews-page";
import { SafetyReviewsPageSkeleton } from "#/features/safety-reviews/components/safety-reviews-page-skeleton";
import { listSafetyReviews } from "#/features/safety-reviews/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/safety-reviews/")({
  head: () => createSeoHead({ title: "Safety reviews — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { safety_review: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listSafetyReviews(),
  component: () => <SafetyReviewsPage reviews={Route.useLoaderData()} />,
  pendingComponent: SafetyReviewsPageSkeleton,
});
