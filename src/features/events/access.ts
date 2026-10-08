import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EquipmentReleaseRecord } from "#/features/equipment-requests/schema";
import type { RegistrationAvailability } from "#/features/events/registration";
import type { VenueSuggestion } from "#/features/venue-requests/schema";

export type EventAccess =
  | "organiser"
  | "coordinator"
  | "venue_staff"
  | "technical_support"
  | "attendee";

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
}

export function getEventAccess(input: EventAccessInput): EventAccess | null {
  if (input.role === "event_organiser" && input.organiserId === input.userId) return "organiser";
  if (input.role === "event_coordinator" && input.assignedCoordinatorId === input.userId) {
    return "coordinator";
  }
  if (input.role === "venue_staff" && input.venueStaffIds.includes(input.userId))
    return "venue_staff";
  if (
    input.role === "technical_support_staff" &&
    input.technicalSupportIds.includes(input.userId)
  ) {
    return "technical_support";
  }
  // PTR-44: a browsing attendee sees a confirmed event with registration on; the live window is
  // not a gate here (PTR-45/PTR-50 own it at the registration action). An own registration keeps
  // a non-draft event visible. This mirrors the attendee leg of `connectedEventCondition` in SQL.
  if (
    input.role === "attendee" &&
    (isPublishedForAttendees(input) || (input.status !== "draft" && input.hasOwnRegistration))
  )
    return "attendee";
  return null;
}

/** PTR-44 AC1/AC5: the events a browsing attendee may open — confirmed with registration on. */
export function isPublishedForAttendees(event: {
  status: EventRequestStatus;
  registrationEnabled?: boolean;
}): boolean {
  return event.status === "confirmed" && event.registrationEnabled === true;
}

/** PTR-50 AC4: the events with an Attendee page — a published one, or one since cancelled. */
export function hasAttendeePage(event: {
  status: EventRequestStatus;
  registrationEnabled?: boolean;
}): boolean {
  return isPublishedForAttendees(event) || event.status === "cancelled";
}

/**
 * The one queue rule both staff queues share: a staff member works the rows assigned to them,
 * plus every unassigned one still in an open status. `isVenueQueueRow` and
 * `isEquipmentQueueRow` are thin wrappers over this so the rule has one home. This module is
 * client-reachable, so it carries no `#/db` import.
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
 * The shared venue queue (PTR-31): a Venue Staff member works the rows assigned to them, plus
 * every unassigned `pending` one. `records.server.ts` scopes its event-list query with the same
 * rule in SQL and calls this for its in-memory readers, so the rule has one home.
 */
export function isVenueQueueRow(
  row: { assignedStaffId: string | null; status: string },
  userId: string
): boolean {
  return isQueueRow({ assignedStaffId: row.assignedStaffId, queueStatus: row.status }, userId, [
    "pending",
  ]);
}

/** The first proposed window with both sides present — a submitted request has at least one. */
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
 * PTR-34 criterion 3: what the requesting Coordinator sees of a rejected venue request, so
 * planning continues rather than restarting. `venueName`/`date`/`startTime`/`endTime` are the
 * rejected booking's own venue and period, not the suggestion — the Coordinator otherwise has no
 * way to tell which booking a bare reason like "Fully booked" refers to. `suggestion` is null when
 * Venue Staff gave none; otherwise each part they did give, with the rest null. Times are `HH:MM`.
 */
export interface VenueRequestRejection {
  /** The rejected venue's id, so an adjusted request can fall back to it. */
  venueId: number;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  suggestion: VenueSuggestion | null;
  /** The suggested venue's id when Venue Staff named one; the adjusted request opens there. */
  suggestedVenueId: number | null;
}

/** A released booking remains visible to the Coordinator as an operational audit record. */
export interface VenueRequestRelease {
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  changedByName: string | null;
}

/**
 * The card's one venue request. PTR-36: `conflict` is present only when a pending request overlaps
 * an approved booking. PTR-34: `rejection` is the last rejection, which only the assigned
 * Coordinator is shown; it stays beside a newer pending request so the reason that prompted an
 * adjusted request is still on the record.
 */
export interface EventVenueRequest {
  status: string;
  conflict?: "booking" | "hold";
  rejection?: VenueRequestRejection;
  release?: VenueRequestRelease;
}

/**
 * The current approved booking of an event. The Organiser and the Coordinator see it for confirmed
 * events. An Attendee sees it for the published events and for the events they registered for.
 * Times are `HH:MM`, dates are `YYYY-MM-DD`, and `endDate` is the booking's end day.
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

/**
 * How many places a published event has taken and how many it has. `registered` counts the normal
 * registrations against `capacity`, the registration capacity PTR-48 shows the Organiser and the
 * Coordinator. `limit` is the lower of that capacity and the venue places its `vip` registrations
 * leave, which PTR-45 shows an Attendee; the VIPs are counted separately because they take venue
 * places only.
 */
export interface EventPlaces {
  registered: number;
  vip: number;
  limit: number;
  capacity: number;
}

/**
 * PTR-111: an Attendee account as the Organiser and the assigned Coordinator see it when they
 * manage VIPs: a VIP registration, or a search result to add as one.
 */
export interface VipAttendee {
  attendeeId: string;
  name: string;
  email: string;
}

/**
 * PTR-48: one Attendee registered for an event, as its Organiser and assigned Coordinator read the
 * list. `registeredAt` is serialized to an ISO string for the client.
 */
export interface EventRegistrationRow {
  attendeeId: string;
  name: string;
  email: string;
  vip: boolean;
  registeredAt: string;
}

/**
 * PTR-24 AC3: what an Organiser or Coordinator sees of a confirmed event — who confirmed it and
 * when, and the venue booking it was confirmed against. `venue` is null when that booking has
 * since been released: the status does not move by itself (AC6), so the view says the booking is
 * gone rather than hiding the confirmation.
 */
export interface EventConfirmation {
  confirmedAt: string;
  confirmedByName: string;
  venue: EventVenue | null;
}

/**
 * One equipment line as a client receives it. `arrangementNotes` and `unavailableReason` are
 * Technical Support's annotations (PTR-39); only the Coordinator and Technical Support are given
 * them, so the Organiser's copy of a line carries the state alone.
 */
export interface EquipmentLineProjection {
  id: string;
  item: string;
  quantity: number;
  arrangementStatus: string;
  notes: string | null;
  arrangementNotes?: string | null;
  unavailableReason?: string | null;
  /**
   * Technical Support only: whether this member may update the line (`isEquipmentQueueRow`), so
   * a line a colleague is arranging is shown to them read-only rather than as a form that would
   * be refused.
   */
  arrangeable?: boolean | undefined;
  /** Technical Support only: the name of the member arranging the line, null when unclaimed. */
  assignedStaffName?: string | null | undefined;
  /** PTR-41 AC4: the line's reserved units when a reservation exists, so the view can show it. */
  reservedQuantity?: number | null | undefined;
  /**
   * PTR-42: the most recent reduce or release, so the view can show what changed. Mirrors
   * `reservedQuantity` above: present for Technical Support and the Coordinator, absent for
   * the Organiser.
   */
  lastRelease?: EquipmentReleaseRecord | null | undefined;
}

/**
 * What a client receives: the caller's access plus the fields their story names, and nothing
 * else. The branches below are the whole contract — a field added to `EventRecord` reaches a
 * client only when its branch is changed to carry it.
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
    registration?: { status: string; registeredAt: string } | null;
    /** PTR-45 AC10: the event's normal `registered` registrations against its place limit. */
    places?: EventPlaces | null;
    /** PTR-50: whether the Attendee can register now and, when not, why. */
    registrationAvailability?: RegistrationAvailability | null;
    /**
     * PTR-111 AC4: the Organiser's and the Coordinator's VIP registrations, apart from the normal
     * ones. Null unless the event is published, the only state that takes them.
     */
    vipRegistrations?: VipAttendee[] | null;
    venue?: EventVenue | null;
    venueRequest?: EventVenueRequest | null;
    equipment?: EquipmentLineProjection[];
    confirmation?: EventConfirmation | null;
    /** Why the Coordinator cannot complete this confirmed event now; null means it is eligible. */
    completionUnavailableReason?: string | null;
  };
}

/**
 * PTR-43: the states that count as arranged.
 */
export function isArrangedLine(arrangementStatus: string): boolean {
  return arrangementStatus === "reserved" || arrangementStatus === "not_required";
}

/**
 * PTR-43 AC4: The recorded completion state is read only while every equipment line is still
 * reserved or not required. If any line is in another state, or no completion was recorded,
 * null is returned.
 */
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
 * PTR-43 AC4/AC6, PTR-24 AC5: whether the equipment side of an event is satisfied. An event with
 * no recorded equipment requirements is satisfied without any completion action; an event with
 * lines needs arrangements marked complete while every line is still `reserved` or
 * `not_required`. This is the value PTR-24's confirmation gate reads.
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
 * The role-specific projection (PTR-8 criteria 3 and 4). The attendee branch carries PTR-44
 * AC2's fields — name, description, date/time, the registration period, the attendee's own
 * registration, and the current approved booking (null once released) — plus PTR-45's count of
 * places and PTR-50's registration state, and no booking
 * decisions, equipment, or clarification threads.
 */
export function projectEvent(
  record: EventRecord,
  access: EventAccess,
  ownRegistration: { status: string; registeredAt: string } | null,
  equipment: EquipmentLineProjection[],
  venueRequest: EventVenueRequest | null,
  currentVenue: EventConfirmation["venue"] = null,
  places: EventPlaces | null = null,
  vipRegistrations: VipAttendee[] | null = null,
  completionUnavailableReason?: string | null,
  registrationAvailability: RegistrationAvailability | null = null
): EventProjection {
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

    // PTR-31 criterion 2: event timing, expected attendance, layout, accessibility and required
    // facilities — and no other event information, so not even the name. The stage is the one
    // exception every branch carries (PTR-21 criterion 2): anyone with access sees it.
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
          venueRequest,
        },
      };

    case "technical_support":
      return {
        access,
        event: {
          id: record.id,
          name: record.name,
          ...timing,
          status: record.status,
          equipment,
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
          // PTR-39 AC4: the Coordinator sees Technical Support's notes and reasons, the Organiser
          // sees the state alone.
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
                }
              : {}),
          })),
          venueRequest,
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
          vipRegistrations,
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
        },
      };

    default: {
      // Exhaustiveness, not a fallback: a new `EventAccess` member must add its own branch above
      // rather than inherit the full-record projection meant for the organiser and coordinator.
      const unhandled: never = access;
      throw new Error(`No event projection for access "${String(unhandled)}"`);
    }
  }
}

/**
 * The shared equipment queue (PTR-38 AC5: submitted events reach the shared queue; assignment
 * still grants its own staff access), mirroring isVenueQueueRow: an unassigned `requested` line
 * of a submitted event is visible to every Technical Support Staff member; once a line is
 * picked up (assignedStaffId set), only that staff member sees it through this row. An
 * unassigned `reserved` line is queueable too: deleting the holder's account nulls the
 * assignment and leaves the reservation holding, so without this leg the units could never be
 * released.
 */
export function isEquipmentQueueRow(
  row: { assignedStaffId: string | null; arrangementStatus: string },
  userId: string,
  eventSubmitted: boolean
): boolean {
  // The same shared rule, with the eventSubmitted gate applied only on the unassigned leg: an
  // unassigned line reaches the queue only once the Coordinator has submitted.
  return (
    isQueueRow(
      { assignedStaffId: row.assignedStaffId, queueStatus: row.arrangementStatus },
      userId,
      ["requested", "reserved"]
    ) &&
    (row.assignedStaffId !== null || eventSubmitted)
  );
}
