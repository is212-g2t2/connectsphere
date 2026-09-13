/** Period endpoints may be explicit instants or floating venue-local wall-clock values. */
export interface AvailabilityPeriod {
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityRequest extends AvailabilityPeriod {
  venueId: string;
}

/** Read projection only: these types do not define venue or booking persistence schemas. */
export interface AvailabilityBooking extends AvailabilityPeriod {
  id: string;
  venueId: string;
  status: "approved" | "pending" | "rejected" | "cancelled";
}

export interface AvailabilityBlock extends AvailabilityPeriod {
  id: string;
  venueId: string;
}

export interface OccupiedPeriod extends AvailabilityPeriod {
  id: string;
  state: "confirmed" | "blocked";
  visibleStart: string;
  visibleEnd: string;
}

export interface AvailabilityProjection {
  occupied: OccupiedPeriod[];
  available: AvailabilityPeriod[];
}

export type AvailabilityTimeMode = "instant" | "floating";
