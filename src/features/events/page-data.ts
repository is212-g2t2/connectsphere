import type { ReactNode } from "react";

import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import type { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
import type { EventProjection, RegisteredAttendee } from "#/features/events/access";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
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
 * projection for it: the loader reads the queue detail instead (PTR-144). The shell and the
 * section modules then stay client-safe. This module carries types alone.
 */
export type EventPageData =
  | {
      kind: "event";
      event: EventProjection;
      viewerId: string;
      organiserRequest?: EventRequestDetail | null;
      coordination?: {
        request: CoordinationRequest;
        coordinators: Coordinator[];
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
    }
  | {
      kind: "triage";
      viewerId: string;
      request: CoordinationRequest;
    };

/** One stacked block of the staff event page with its section entry, gate, and body. */
export interface EventSectionDef {
  id: string;
  label: string;
  visible: (data: EventPageData) => boolean;
  render: (data: EventPageData) => ReactNode;
}
