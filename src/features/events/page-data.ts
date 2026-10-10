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
 * Everything the universal event page needs, gathered by the route loader. Every field beyond
 * `event` is present only for the access that reads it. A coordinator opening an event they are
 * not assigned to gets no projection at all — the triage view of the underlying request instead —
 * so the shell and the section modules stay client-safe. This module carries types alone.
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
      venueDecision?: {
        request: PendingVenueRequestDetail;
        venues: VenueOption[];
      } | null;
      equipmentTypes?: EquipmentTypeOption[] | null;
      attendees?: RegisteredAttendee[] | null;
    }
  | {
      kind: "triage";
      viewerId: string;
      request: CoordinationRequest;
      coordinators: Coordinator[];
    };

/** One stacked block of the staff event page: its jump-nav entry, its gate, and its body. */
export interface EventSectionDef {
  id: string;
  label: string;
  visible: (data: EventPageData) => boolean;
  render: (data: EventPageData) => ReactNode;
}
