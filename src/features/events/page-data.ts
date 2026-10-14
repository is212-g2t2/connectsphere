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
 * `event` only for the access that reads it. A coordinator opening an unassigned event gets no
 * projection. They get the triage view of the underlying request instead. The shell and the
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
       * One loaded pending request with its venue options, in projection order. A pending
       * entry whose read failed stays visible from the projection but has no entry here.
       */
      venueDecisions?: Array<{
        request: PendingVenueRequestDetail;
        venues: VenueOption[];
      }>;
      equipmentTypes?: EquipmentTypeOption[] | null;
      attendees?: RegisteredAttendee[] | null;
    }
  | {
      kind: "triage";
      viewerId: string;
      request: CoordinationRequest;
      coordinators: Coordinator[];
    };

/** One stacked block of the staff event page with its section entry, gate, and body. */
export interface EventSectionDef {
  id: string;
  label: string;
  visible: (data: EventPageData) => boolean;
  render: (data: EventPageData) => ReactNode;
}
