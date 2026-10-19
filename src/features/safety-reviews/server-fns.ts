import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseEventRequestId } from "#/features/event-requests/schema";
import { parseSafetyReviewDecision } from "#/features/safety-reviews/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("safety-reviews");

/**
 * Routes import this module, so do not add static server imports here. The handlers import the
 * `*.server` modules and `#/db` dynamically; TanStack Start removes the handlers from the client
 * build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/safety-reviews/reviews.server")]);
}

const requireSafetyReviewRead = requirePermission({ safety_review: ["read"] });
const requireSafetyReviewDecide = requirePermission({ safety_review: ["decide"] });

/**
 * PTR-146 AC2: the Safety Officer's review list. The permission opens the list; the handler reads
 * the shared queue, so one Safety Officer sees every pending review.
 */
export const listSafetyReviews = createServerFn({ method: "GET" })
  .middleware([requireSafetyReviewRead])
  .handler(async () => {
    const [{ db }, { handleListSafetyReviews }] = await loadServer();
    return handleListSafetyReviews(db);
  });

/**
 * PTR-146 AC5: the event's current review for its page. The permission opens the read; the
 * handler re-reads which event carries the review.
 */
export const getEventSafetyReview = createServerFn({ method: "GET" })
  .middleware([requireSafetyReviewRead])
  .validator(parseEventRequestId)
  .handler(async ({ data }) => {
    const [{ db }, { handleGetEventSafetyReview }] = await loadServer();
    return handleGetEventSafetyReview(data, db);
  });

/**
 * PTR-146 AC3/AC4: the Safety Officer's decision. The permission states that the caller may
 * decide; the handler re-reads the review, the event and the fingerprint under the event lock.
 */
export const decideSafetyReview = createServerFn({ method: "POST" })
  .middleware([requireSafetyReviewDecide])
  .validator(parseSafetyReviewDecision)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDecideSafetyReview }] = await loadServer();
    const result = await handleDecideSafetyReview(data, context.user, db);

    log.info("Safety review decided", {
      reviewId: result.reviewId,
      eventId: result.eventId,
      decision: result.state,
      actorId: context.user.id,
    });

    return result;
  });
