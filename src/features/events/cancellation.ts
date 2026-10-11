/** PTR-54 AC9: the refusal of any new arrangement or registration on a cancelled event. */
export const CANCELLED_EVENT_ACTIVITY_MESSAGE =
  "This event is cancelled. It takes no new venue bookings, equipment reservations, tentative holds or registrations.";
export const NO_CANCELLATION_REQUEST_MESSAGE =
  "There is no cancellation request waiting for this event.";

/** One venue period, in the floating venue-local spelling the columns use. */
interface VenuePeriod {
  id: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-54 AC2, AC6: List what a cancelled event still holds. Release nothing automatically. The
 * Coordinator sees each item until the responsible staff release it. A hold carries its venue,
 * so the list can open the venue calendar for release. PTR-23 AC3 reads the same shape for a
 * live event. The warning before a significant change names what the event holds.
 */
export interface OutstandingReleases {
  venueBookings: VenuePeriod[];
  venueHolds: (VenuePeriod & { venueId: number })[];
  equipmentReservations: { id: string; item: string; quantity: number }[];
}
