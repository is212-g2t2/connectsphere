import type { SessionUser } from "#/features/auth/session";
import {
  handlePlaceVenueHold,
  handleRequestVenueHold,
} from "#/features/venue-requests/holds.server";

/**
 * PTR-151: the handlers no longer create a held hold in one call. A hold exists only after the
 * Coordinator requests it and Venue Staff place it. Tests that need a `held` hold call this helper.
 * The expiry is far in the future and clear of the windows these suites sweep, so a placement
 * accepts it and a sweep at the suite's own clock leaves it alone.
 */
export const HOLD_REQUEST_EXPIRY = "2099-06-14T12:00";

type HoldDatabase = Parameters<typeof handleRequestVenueHold>[2];

export async function requestAndPlaceHold(
  data: unknown,
  actor: SessionUser,
  database: HoldDatabase,
  expiresAt = HOLD_REQUEST_EXPIRY
) {
  const request = await handleRequestVenueHold(data, actor, database);
  return handlePlaceVenueHold({ id: request.id, expiresAt }, actor, database);
}
