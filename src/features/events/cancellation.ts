/** PTR-54 AC9: the refusal of any new arrangement or registration on a cancelled event. */
export const CANCELLED_EVENT_ACTIVITY_MESSAGE =
  "This event is cancelled. It takes no new venue bookings, equipment reservations, tentative holds or registrations.";
export const NO_CANCELLATION_REQUEST_MESSAGE =
  "There is no cancellation request waiting for this event.";

/** One period at a venue, in the floating venue-local spelling the columns read back. */
interface VenuePeriod {
  id: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-54 AC2, AC6: what a cancelled event still holds. Nothing is released automatically, so the
 * Coordinator sees each item until the staff concerned release it. A hold carries its venue, so
 * the list can open the venue calendar where the Coordinator releases it.
 */
export interface OutstandingReleases {
  venueBookings: VenuePeriod[];
  venueHolds: (VenuePeriod & { venueId: number })[];
  equipmentReservations: { id: string; item: string; quantity: number }[];
}
