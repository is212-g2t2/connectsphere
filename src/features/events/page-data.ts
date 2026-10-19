import type { ReactNode } from "react";

import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import type { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
import type { EventProjection, RegisteredAttendee } from "#/features/events/access";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import type { SafetyReviewDetail } from "#/features/safety-reviews/schema";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";

/** One equipment type the availability checker offers, as `listEquipmentTypes` returns it. */
export type EquipmentTypeOption = Awaited<ReturnType<typeof listEquipmentTypes>>[number];

/** One venue the venue staff decision form offers. */
export interface VenueOption {
  id: number;
  name: string;
}

/**
 * Gather everything the universal event page needs in the route loader. Include each field beyond
 * `event` only for the access that reads it. The Lead opening an unassigned event gets no
 * projection for it: the loader reads the queue detail instead (PTR-144). PTR-145 gives the Lead
 * the coordination read on an assigned event too, for the reassignment form. The shell and the
 * section modules then stay client-safe. This module carries types alone.
 */
export type EventPageData =
  | {
      kind: "event";
      event: EventProjection;
      organiserRequest?: EventRequestDetail | null;
      /**
       * PTR-145: the assignment read. Only the Lead's page fills `coordinators`; the
       * Coordinator's page carries the request alone.
       */
      coordination?: {
        request: CoordinationRequest;
        coordinators?: Coordinator[];
      } | null;
      /**
       * Venue Staff only: the full pending requests that one read loaded, and the venue options
       * the decision forms offer. Unset when nothing was pending or the read failed. A pending
       * projection entry with no request here was decided after the projection loaded.
       */
      venueDecisions?: {
        requests: PendingVenueRequestDetail[];
        venues: VenueOption[];
      };
      equipmentTypes?: EquipmentTypeOption[] | null;
      attendees?: RegisteredAttendee[] | null;
      /**
       * PTR-146: Safety Officer only. The event's current review. Unset when the read failed;
       * `null` when the event has no review.
       */
      safetyReview?: SafetyReviewDetail | null;
    }
  | {
      kind: "triage";
      request: CoordinationRequest;
      /** PTR-145: every Event Coordinator, the Lead's assignment candidates. */
      coordinators: Coordinator[];
    };

/** One stacked block of the staff event page with its section entry, gate, and body. */
export interface EventSectionDef {
  id: string;
  label: string;
  visible: (data: EventPageData) => boolean;
  render: (data: EventPageData) => ReactNode;
}
