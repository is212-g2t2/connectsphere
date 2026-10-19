import type { EventRequestStatus } from "#/features/event-requests/schema";
import type {
  EquipmentBookingOption,
  EquipmentReleaseRecord,
} from "#/features/equipment-requests/schema";
import type { RegistrationAvailability } from "#/features/events/registration";
import type {
  SessionRequirements,
  VenueRequestConflict,
  VenueRequestStatus,
  VenueSuggestion,
} from "#/features/venue-requests/schema";

export type EventAccess =
  | "organiser"
  | "coordinator"
  | "lead"
  | "venue_staff"
  | "technical_support"
  | "attendee"
  /** PTR-146: a Safety Officer reads an event that has a safety review. */
  | "safety_officer";

interface EventAccessInput {
  role: string | null | undefined;
  userId: string;
  organiserId: string;
  assignedCoordinatorId: string | null;
  venueStaffIds: string[];
  technicalSupportIds: string[];
  status: EventRequestStatus;
  registrationEnabled: boolean;
  hasOwnRegistration: boolean;
  /** PTR-146: the event has at least one safety review. */
  hasSafetyReview: boolean;
}

export function getEventAccess(input: EventAccessInput): EventAccess | null {
  if (input.role === "event_organiser" && input.organiserId === input.userId) return "organiser";
  if (input.role === "event_coordinator" && input.assignedCoordinatorId === input.userId) {
    return "coordinator";
  }
  // PTR-144: the Event Coordinator Lead reads every non-draft event, assigned or not. This
  // matches the `event_coordinator_lead` arm of `connectedEventCondition` in
  // `events/records.server.ts`, which lists every non-draft event. The projection is read-only and
  // offers no coordination action.
  if (input.role === "event_coordinator_lead" && input.status !== "draft") return "lead";
  if (input.role === "venue_staff" && input.venueStaffIds.includes(input.userId))
    return "venue_staff";
  if (
    input.role === "technical_support_staff" &&
    input.technicalSupportIds.includes(input.userId)
  ) {
    return "technical_support";
  }
  // PTR-146: every Safety Officer reads every event under review. The review row is the
  // relationship, so a decided review keeps the event readable. A draft has no review, and the
  // SQL arm excludes drafts too; keep the same guard here.
  if (input.role === "safety_officer" && input.status !== "draft" && input.hasSafetyReview) {
    return "safety_officer";
  }
  // PTR-44: A browsing Attendee sees confirmed events with registration open. The registration
  // action checks the registration window (PTR-45/PTR-50). An existing registration keeps a
  // non-draft event visible. This matches `connectedEventCondition` in SQL.
  if (
    input.role === "attendee" &&
    (isPublishedForAttendees(input) || (input.status !== "draft" && input.hasOwnRegistration))
  )
    return "attendee";
  return null;
}

/** PTR-44 AC1/AC5: Events a browsing Attendee may open: confirmed events with registration on. */
export function isPublishedForAttendees(event: {
  status: EventRequestStatus;
  registrationEnabled?: boolean;
}): boolean {
  return event.status === "confirmed" && event.registrationEnabled === true;
}

/** PTR-50 AC4: List the events with an Attendee page. A published event has one, and so does a cancelled one. */
export function hasAttendeePage(event: {
  status: EventRequestStatus;
  registrationEnabled?: boolean;
}): boolean {
  return isPublishedForAttendees(event) || event.status === "cancelled";
}

/**
 * The one queue rule both staff queues share. Show assigned rows and unassigned rows in an
 * open status. `isVenueQueueRow` and `isEquipmentQueueRow` wrap this rule, so it has one home.
 * This module is client-reachable, so do not import `#/db` here.
 */
function isQueueRow(
  row: { assignedStaffId: string | null; queueStatus: string },
  userId: string,
  openStatuses: readonly string[]
): boolean {
  return row.assignedStaffId === null
    ? openStatuses.includes(row.queueStatus)
    : row.assignedStaffId === userId;
}

/**
 * PTR-31: Venue Staff can work on their assigned rows and all unassigned `pending` rows.
 * `records.server.ts` scopes its event-list query with the same rule in SQL. Keep them in sync.
 */
export function isVenueQueueRow(
  row: { assignedStaffId: string | null; status: string },
  userId: string
): boolean {
  return isQueueRow({ assignedStaffId: row.assignedStaffId, queueStatus: row.status }, userId, [
    "pending",
  ]);
}

/** Return the first proposed window with both start and end values. Submitted requests have one. */
export function eventTiming(dates: Array<{ start?: string; end?: string }>) {
  const window = dates.find(date => date.start !== undefined && date.end !== undefined);
  if (window?.start === undefined || window.end === undefined) {
    return { eventDate: null, endDate: null, startTime: null, endTime: null };
  }
  return {
    eventDate: window.start.slice(0, 10),
    endDate: window.end.slice(0, 10),
    startTime: window.start.slice(11),
    endTime: window.end.slice(11),
  };
}

interface EventRecord {
  id: number;
  name: string;
  description: string;
  status: EventRequestStatus;
  proposedDates: Array<{ start?: string; end?: string }>;
  registrationEnabled: boolean;
  /** PTR-144: the Lead's projection states whether the request still waits for a Coordinator. */
  assignedCoordinatorId?: string | null;
  equipmentSubmittedAt?: Date | null;
  equipmentArrangementsCompletedAt?: Date | null;
  confirmedAt?: Date | null;
  confirmedByName?: string | null;
  expectedAttendance: number | null;
  roomLayoutPreference: string;
  accessibilityRequirements: string;
  venueRequirements: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
}

/**
 * PTR-34 criterion 3: Data about a rejected request for the Coordinator. Keep planning without a
 * new request. The entry that carries it names the rejected venue and window. `suggestion` is
 * null when Venue Staff made no suggestion. Missing suggestion fields are also null. Times use
 * `HH:MM` format.
 */
export interface VenueRequestRejection {
  /** The rejected venue's id, so an adjusted request can fall back to it. */
  venueId: number;
  reason: string;
  suggestion: VenueSuggestion | null;
  /** The suggested venue's id when Venue Staff named one; the adjusted request opens there. */
  suggestedVenueId: number | null;
}

/**
 * Keep released bookings visible to Coordinators as audit records. The entry that carries the
 * release names its venue and window.
 */
export interface VenueRequestRelease {
  reason: string;
  changedByName: string | null;
}

/**
 * One venue booking request on an event card. An event can have several venue requests, one row
 * for each event, venue and window. `conflict` is present only on a pending request that overlaps
 * the ledger or that the venue cannot host (PTR-36, PTR-138 AC1). Only a rejected row has
 * `rejection`, and only a released row has `release`.
 *
 * Each role sees a different set of rows. The visibility filter in `handleListEvents`
 * (`events/records.server.ts`) states the rule.
 */
export interface EventVenueRequest {
  /** The venue_requests row id (text), so the venue-staff decision can load its detail. */
  id: string;
  status: VenueRequestStatus;
  /** The requested venue's name. */
  venueName: string;
  /** The requested window: date as `YYYY-MM-DD`, times as `HH:MM`. */
  date: string;
  startTime: string;
  endTime: string;
  /** Coordinator only (PTR-138 AC1): the session requirements that the request carries. */
  requirements?: SessionRequirements;
  conflict?: VenueRequestConflict;
  rejection?: VenueRequestRejection;
  release?: VenueRequestRelease;
  /** Coordinator only (PTR-35): set on a rejected entry while the Coordinator can still adjust
   * it. Other entries omit the field. */
  adjustable?: true;
  /** PTR-165 AC4: the assigned Coordinator dismissed this settled entry, so it does not block
   * confirmation. */
  dismissed?: true;
}

/**
 * PTR-151: one requested hold on the event's venue section. It reserves no venue time until Venue
 * Staff place it. Times keep the floating venue-local `YYYY-MM-DDTHH:MM:SS` spelling.
 */
export interface EventHoldRequest {
  id: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-137 AC1: a booking or hold of the event that a live venue block has suspended. The
 * Coordinator sees it with the block's reason and period until the block is lifted or the
 * arrangement is released. Times keep the floating venue-local `YYYY-MM-DD HH:MM:SS` spelling.
 */
export interface BlockedArrangement {
  kind: "booking" | "hold";
  /** The `venue_requests` or `venue_holds` row id. */
  id: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
  /** Every live block that suspends a piece of this arrangement, in piece order. */
  blocks: { reason: string; startsAt: string; endsAt: string | null }[];
}

/**
 * The event's current approved booking. Organisers and Coordinators see it for confirmed events.
 * Attendees see it for published events and events they registered for. Times use `HH:MM` format.
 * Dates use `YYYY-MM-DD` format. `endDate` is the last booking day.
 */
export interface EventVenue {
  name: string;
  location: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export interface AttendeeRegistrationProjection {
  eventId: number;
  eventName: string;
  eventStatus: EventRequestStatus;
  registrationEnabled: boolean;
  registrationStatus: "registered" | "withdrawn";
  eventDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: EventVenue | null;
}

/** Count normal and VIP registrations against the event's place limit. The limit is the lower of
 * registration capacity and venue places after VIPs.
 */
export interface EventPlaces {
  registered: number;
  vip: number;
  limit: number;
  capacity: number;
}

/** PTR-111: An Attendee account or search result shown while managing VIP registrations. */
export interface VipAttendee {
  attendeeId: string;
  name: string;
  email: string;
}

/** One attendee-list row for an Organiser or Coordinator, with VIP status and an ISO timestamp. */
export interface RegisteredAttendee {
  attendeeId: string;
  name: string;
  email: string;
  vip: boolean;
  registeredAt: string;
}

/**
 * PTR-24 AC3: Show who confirmed an event and when, with its venue booking. Set `venue` to null
 * if the booking was released. The event stays confirmed (AC6), so keep the confirmation visible.
 */
export interface EventConfirmation {
  confirmedAt: string;
  confirmedByName: string;
  venue: EventVenue | null;
}

/**
 * One equipment line sent to a client. Only Coordinators and Technical Support receive
 * `arrangementNotes` and `unavailableReason` (PTR-39). Organisers receive the state only.
 */
export interface EquipmentLineProjection {
  id: string;
  item: string;
  quantity: number;
  arrangementStatus: string;
  notes: string | null;
  arrangementNotes?: string | null;
  unavailableReason?: string | null;
  /** Technical Support only: Whether this member may update the line. Other members see it read-only. */
  arrangeable?: boolean | undefined;
  /** Technical Support only: The assigned member's name, or null when unassigned. */
  assignedStaffName?: string | null | undefined;
  /** PTR-41 AC4: The line's reserved units, when a reservation exists. */
  reservedQuantity?: number | null | undefined;
  venueRequestId?: string | null | undefined;
  windowChanged?: boolean | undefined;
  /** PTR-42: The latest reduction or release. Shown to Technical Support and Coordinators only. */
  lastRelease?: EquipmentReleaseRecord | null | undefined;
}

/**
 * Return only the fields allowed for the caller's access. Add fields to a branch here before they
 * can reach a client from `EventRecord`.
 */
export interface EventProjection {
  access: EventAccess;
  event: {
    id: number;
    name?: string;
    description?: string;
    eventDate: string | null;
    endDate?: string | null;
    startTime: string | null;
    endTime: string | null;
    equipmentSubmittedAt?: string | null;
    equipmentArrangementsCompletedAt?: string | null;
    equipmentArrangementsSatisfied?: boolean;
    status: EventRequestStatus;
    registrationOpensAt?: string | null;
    registrationClosesAt?: string | null;
    registrationEnabled?: boolean;
    expectedAttendance?: number | null;
    layout?: string | null;
    accessibilityRequirements?: string | null;
    requiredFacilities?: string | null;
    /** PTR-146: Safety Officer only. The current venue's maximum capacity. */
    venueCapacity?: number | null;
    /**
     * PTR-146: Safety Officer only. The current booking's own session requirements (PTR-138),
     * which the arrangement fingerprint hashes.
     */
    sessionRequirements?: {
      expectedAttendance: number | null;
      layout: string | null;
      accessibilityRequirements: string | null;
      requiredFacilities: string | null;
    } | null;
    registration?: { status: string; registeredAt: string } | null;
    /** PTR-45 AC10: the event's normal `registered` registrations against its place limit. */
    places?: EventPlaces | null;
    /** PTR-50: whether the Attendee can register now and, when not, why. */
    registrationAvailability?: RegistrationAvailability | null;
    venue?: EventVenue | null;
    /** One entry per non-withdrawn venue request, ordered by start time. Omitted for Attendees
     * and Technical Support. */
    venueRequests?: EventVenueRequest[];
    equipment?: EquipmentLineProjection[];
    equipmentBookings?: EquipmentBookingOption[];
    confirmation?: EventConfirmation | null;
    /** Why the Coordinator cannot complete this confirmed event now; null means it is eligible. */
    completionUnavailableReason?: string | null;
    /** PTR-137 AC1: Coordinator only. The arrangements a live venue block has suspended. */
    blockedArrangements?: BlockedArrangement[];
    /** PTR-151: Coordinator only. Holds that wait for Venue Staff to place them. */
    holdRequests?: EventHoldRequest[];
    /** PTR-144: Lead only. The request still waits for a Coordinator, so its page opens the
     * read-only queue detail instead of the projection. */
    awaitingAssignment?: boolean;
  };
}

/**
 * PTR-43: the states that count as arranged.
 */
export function isArrangedLine(arrangementStatus: string): boolean {
  return arrangementStatus === "reserved" || arrangementStatus === "not_required";
}

/** PTR-43 AC4: Return completion only when every line is `reserved` or `not_required`. Otherwise, return null. */
export function effectiveEquipmentArrangementsCompletedAt(
  completedAt: Date | null | undefined,
  equipment: Array<{ arrangementStatus: string }>
): string | null {
  if (!completedAt) return null;
  const allArranged =
    equipment.length > 0 && equipment.every(line => isArrangedLine(line.arrangementStatus));
  return allArranged ? completedAt.toISOString() : null;
}

/**
 * PTR-43 AC4/AC6, PTR-24 AC5: Check whether the event's equipment requirements are met. No lines
 * means the event is ready without a completion action. Otherwise, all lines must be `reserved`
 * or `not_required`, and arrangements must be complete. The confirmation gate uses this value.
 */
export function isEquipmentArrangementsSatisfied(
  equipment: readonly { arrangementStatus: string }[],
  completedAt: Date | string | null | undefined
): boolean {
  if (equipment.length === 0) return true;
  if (!completedAt) return false;
  return equipment.every(line => isArrangedLine(line.arrangementStatus));
}

/**
 * PTR-8 criteria 3 and 4: Build each role's event view. The Attendee branch includes event details,
 * registration dates, the Attendee's registration, and the approved booking. It also includes the
 * place count and registration state. It excludes booking decisions, equipment, and clarifications.
 */
export function projectEvent(
  record: EventRecord,
  access: EventAccess,
  ownRegistration: { status: string; registeredAt: string } | null,
  equipment: EquipmentLineProjection[],
  venueRequests: EventVenueRequest[],
  currentVenue: EventConfirmation["venue"] = null,
  places: EventPlaces | null = null,
  extras: {
    completionUnavailableReason?: string | null;
    registrationAvailability?: RegistrationAvailability | null;
    /** PTR-137 AC1: the Coordinator's suspended arrangements. */
    blockedArrangements?: BlockedArrangement[];
    /** PTR-151: the Coordinator's hold requests that wait for Venue Staff. */
    holdRequests?: EventHoldRequest[];
    /** PTR-146: the current venue's maximum capacity, for the Safety Officer's copy. */
    venueCapacity?: number | null;
    /** PTR-146: the current booking's own session requirements, which the fingerprint hashes. */
    sessionRequirements?: {
      expectedAttendance: number | null;
      layout: string | null;
      accessibilityRequirements: string | null;
      requiredFacilities: string | null;
    } | null;
    equipmentBookings?: EquipmentBookingOption[];
  } = {}
): EventProjection {
  const {
    completionUnavailableReason,
    registrationAvailability = null,
    blockedArrangements = [],
    holdRequests = [],
    venueCapacity = null,
    sessionRequirements = null,
  } = extras;
  const timing = eventTiming(record.proposedDates);

  switch (access) {
    case "attendee":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          description: record.description,
          ...timing,
          status: record.status,
          registrationOpensAt: record.registrationOpensAt,
          registrationClosesAt: record.registrationClosesAt,
          registrationEnabled: record.registrationEnabled,
          registration: ownRegistration,
          places,
          registrationAvailability,
          venue: currentVenue,
        },
      };

    // PTR-31 criterion 2: Return event timing, attendance, layout, accessibility, and facilities
    // only. Do not return the event name. Every branch also returns the stage (PTR-21 criterion 2).
    case "venue_staff":
      return {
        access,
        event: {
          id: record.id,
          ...timing,
          status: record.status,
          expectedAttendance: record.expectedAttendance,
          layout: record.roomLayoutPreference,
          accessibilityRequirements: record.accessibilityRequirements,
          requiredFacilities: record.venueRequirements,
          venueRequests,
        },
      };

    case "technical_support":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          description: record.description,
          ...timing,
          status: record.status,
          equipment,
          equipmentBookings: extras.equipmentBookings ?? [],
          equipmentArrangementsCompletedAt: effectiveEquipmentArrangementsCompletedAt(
            record.equipmentArrangementsCompletedAt,
            equipment
          ),
          equipmentArrangementsSatisfied: isEquipmentArrangementsSatisfied(
            equipment,
            record.equipmentArrangementsCompletedAt
          ),
        },
      };

    // PTR-144: the event record the Lead reads, with no coordination field. The branch is
    // read-only: no coordinator-only notes, reasons, or completion state, and no action anywhere
    // on the page. The comment above "organiser" applies: add fields here deliberately.
    case "lead":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          description: record.description,
          ...timing,
          status: record.status,
          registrationOpensAt: record.registrationOpensAt,
          registrationClosesAt: record.registrationClosesAt,
          registrationEnabled: record.registrationEnabled,
          expectedAttendance: record.expectedAttendance,
          layout: record.roomLayoutPreference,
          accessibilityRequirements: record.accessibilityRequirements,
          requiredFacilities: record.venueRequirements,
          equipment: equipment.map(line => ({
            id: line.id,
            item: line.item,
            quantity: line.quantity,
            arrangementStatus: line.arrangementStatus,
            notes: line.notes,
          })),
          equipmentSubmittedAt: record.equipmentSubmittedAt?.toISOString() ?? null,
          // PTR-144: the page swaps this projection for the read-only queue detail while the
          // request waits for a Coordinator.
          awaitingAssignment: record.assignedCoordinatorId === null,
          confirmation:
            record.status === "confirmed" && record.confirmedAt && record.confirmedByName
              ? {
                  confirmedAt: record.confirmedAt.toISOString(),
                  confirmedByName: record.confirmedByName,
                  venue: currentVenue,
                }
              : null,
        },
      };

    // PTR-146 AC5: the Safety Officer assesses capacity, layout, emergency access and crowd
    // movement outside the system, so this branch carries the facts they assess: the event's
    // significant fields, the current venue with its capacity, and every equipment line.
    case "safety_officer":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          description: record.description,
          ...timing,
          status: record.status,
          expectedAttendance: record.expectedAttendance,
          layout: record.roomLayoutPreference,
          accessibilityRequirements: record.accessibilityRequirements,
          requiredFacilities: record.venueRequirements,
          venue: currentVenue,
          venueCapacity,
          sessionRequirements,
          equipment: equipment.map(line => ({
            id: line.id,
            item: line.item,
            quantity: line.quantity,
            arrangementStatus: line.arrangementStatus,
            notes: line.notes,
            reservedQuantity: line.reservedQuantity ?? null,
          })),
        },
      };

    case "organiser":
    case "coordinator":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          description: record.description,
          ...timing,
          status: record.status,
          registrationOpensAt: record.registrationOpensAt,
          registrationClosesAt: record.registrationClosesAt,
          expectedAttendance: record.expectedAttendance,
          layout: record.roomLayoutPreference,
          accessibilityRequirements: record.accessibilityRequirements,
          requiredFacilities: record.venueRequirements,
          places,
          // PTR-39 AC4: Coordinators see Technical Support's notes and reasons. Organisers see only the state.
          equipment: equipment.map(line => ({
            id: line.id,
            item: line.item,
            quantity: line.quantity,
            arrangementStatus: line.arrangementStatus,
            notes: line.notes,
            reservedQuantity: line.reservedQuantity ?? null,
            ...(access === "coordinator"
              ? {
                  arrangementNotes: line.arrangementNotes,
                  unavailableReason: line.unavailableReason,
                  lastRelease: line.lastRelease,
                  venueRequestId: line.venueRequestId,
                  windowChanged: line.windowChanged,
                }
              : {}),
          })),
          venueRequests,
          equipmentSubmittedAt: record.equipmentSubmittedAt?.toISOString() ?? null,
          ...(access === "coordinator"
            ? {
                equipmentArrangementsCompletedAt: effectiveEquipmentArrangementsCompletedAt(
                  record.equipmentArrangementsCompletedAt,
                  equipment
                ),
                equipmentArrangementsSatisfied: isEquipmentArrangementsSatisfied(
                  equipment,
                  record.equipmentArrangementsCompletedAt
                ),
              }
            : {}),
          confirmation:
            record.status === "confirmed" && record.confirmedAt && record.confirmedByName
              ? {
                  confirmedAt: record.confirmedAt.toISOString(),
                  confirmedByName: record.confirmedByName,
                  venue: currentVenue,
                }
              : null,
          ...(access === "coordinator" && completionUnavailableReason !== undefined
            ? { completionUnavailableReason }
            : {}),
          // PTR-137 AC1: only the Coordinator re-plans, so only their copy carries the flag.
          // PTR-151: only the Coordinator withdraws a hold request, so only their copy lists them.
          ...(access === "coordinator" ? { blockedArrangements, holdRequests } : {}),
        },
      };

    default: {
      // Add a branch for each new `EventAccess` value. Do not use the full-record view for other roles.
      const unhandled: never = access;
      throw new Error(`No event projection for access "${String(unhandled)}"`);
    }
  }
}

/**
 * PTR-38 AC5: Show submitted events in the shared equipment queue. All Technical Support members
 * can see unassigned `requested` lines. After assignment, only the assigned member can see the
 * line through this queue. Also show unassigned `reserved` lines. If the assigned member's account
 * is deleted, the line becomes unassigned but still holds units that staff must release.
 */
export function isEquipmentQueueRow(
  row: { assignedStaffId: string | null; arrangementStatus: string },
  userId: string,
  eventSubmitted: boolean
): boolean {
  // Apply the submission check to unassigned lines only. They enter the queue after submission.
  return (
    isQueueRow(
      { assignedStaffId: row.assignedStaffId, queueStatus: row.arrangementStatus },
      userId,
      ["requested", "reserved"]
    ) &&
    (row.assignedStaffId !== null || eventSubmitted)
  );
}
