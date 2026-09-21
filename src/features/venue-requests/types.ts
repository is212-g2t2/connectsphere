/**
 * UI input for the preparatory PTR-32 booking-request components only. A future PTR-31 adapter
 * must supply booking metadata and the stored requirement snapshot; it must never reconstruct
 * requirements from a live event.
 */
export interface BookingRequestSummary {
  readonly id: string;
  readonly venueName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly submittedAt: Date;
}

/** The read-only snapshot fields displayed after a request is selected. */
export interface BookingRequestDetail extends BookingRequestSummary {
  readonly requirements: {
    readonly eventTiming: string;
    readonly expectedAttendance: number;
    readonly layout: string | null;
    readonly accessibility: string | null;
    readonly requiredFacilities: readonly string[];
  };
}
