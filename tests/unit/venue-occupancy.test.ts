import { describe, expect, it } from "vitest";

import { rethrowVenueConflict } from "#/features/venue-requests/occupancy.server";
import {
  venueRequestEventStatusMessage,
  venueRequirementsMessage,
  venueUnavailableMessage,
} from "#/features/venue-requests/requests.server";
import {
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  isVenueConflictMessage,
} from "#/features/venue-requests/schema";

/** Drizzle wraps the driver error in `cause`, as `isConstraintViolation` expects. */
function driverError(cause: Record<string, string>) {
  return new Error("Failed query", { cause });
}

const conflict = { name: "ConflictError", status: 409, message: VENUE_OCCUPANCY_CONFLICT_MESSAGE };

describe("rethrowVenueConflict (PTR-133 AC3)", () => {
  it.each([
    [
      "an exclusion violation from node-postgres",
      { code: "23P01", constraint: "venue_occupancy_no_overlap" },
    ],
    ["a deadlock from node-postgres", { code: "40P01" }],
    // Bun SQL reports a deadlock in this shape (captured from postgres:18).
    ["a deadlock from Bun SQL", { code: "ERR_POSTGRES_SERVER_ERROR", errno: "40P01" }],
  ])("maps %s to the venue-conflict refusal", (_, cause) => {
    expect(() => rethrowVenueConflict(driverError(cause))).toThrow(
      expect.objectContaining(conflict)
    );
  });

  it("answers a message that the approve button shows as a venue conflict", () => {
    expect(isVenueConflictMessage(VENUE_OCCUPANCY_CONFLICT_MESSAGE)).toBe(true);
    // PTR-138: the approve button shows the other approval refusals that name a reason too.
    expect(
      isVenueConflictMessage(venueRequirementsMessage("Room B", ["Holds 40; 80 needed"]))
    ).toBe(true);
    expect(isVenueConflictMessage(venueRequestEventStatusMessage("confirmed"))).toBe(true);
    expect(
      isVenueConflictMessage(
        venueUnavailableMessage("Room B", "Not open 07:00–09:00 on 2027-04-20")
      )
    ).toBe(true);
  });

  it("rethrows any other error unchanged", () => {
    const duplicate = driverError({ code: "23505", constraint: "venue_occupancy_pkey" });
    expect(() => rethrowVenueConflict(duplicate)).toThrow(duplicate);
    const plain = new Error("connection reset");
    expect(() => rethrowVenueConflict(plain)).toThrow(plain);
  });
});
