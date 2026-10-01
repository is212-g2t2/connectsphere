import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EquipmentReleaseRecord } from "#/features/equipment-requests/schema";
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
  isRegistrationWindowOpen: boolean;
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
  if (input.role === "attendee" && (input.isRegistrationWindowOpen || input.hasOwnRegistration))
    return "attendee";
  return null;
}

/**
 * The one queue rule both staff queues share: a staff member works the rows assigned to them,
 * plus every unassigned one still in the pending status. `isVenueQueueRow` and
 * `isEquipmentQueueRow` are thin wrappers over this so the rule has one home. This module is
 * client-reachable, so it carries no `#/db` import.
 */
function isQueueRow(
  row: { assignedStaffId: string | null; queueStatus: string },
  userId: string,
  pendingStatus: string
): boolean {
  return row.assignedStaffId === null
    ? row.queueStatus === pendingStatus
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
  return isQueueRow(
    { assignedStaffId: row.assignedStaffId, queueStatus: row.status },
    userId,
    "pending"
  );
}

/**
 * Whether registration is open at this instant. The stored window is a `datetime-local` string
 * with no offset (PTR-11), so it is read on the same arbitrary meridian the draft schema parses
 * it on, and compared as instants rather than lexicographically. Missing terms or registration
 * turned off fail closed.
 *
 * PTR-8 criterion 4 says "open to registration" for a *published* event; until PTR-21/24 add
 * `confirmed`, the caller applies the status gate for browsing attendees and this only answers
 * the window.
 */
export function isRegistrationWindowOpen(
  request: {
    registrationEnabled: boolean;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  },
  now = new Date()
): boolean {
  const { registrationEnabled, registrationOpensAt, registrationClosesAt } = request;
  if (!registrationEnabled || registrationOpensAt === null || registrationClosesAt === null) {
    return false;
  }
  return (
    Date.parse(`${registrationOpensAt}Z`) <= now.getTime() &&
    now.getTime() < Date.parse(`${registrationClosesAt}Z`)
  );
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
  equipmentSubmittedAt?: Date | null;
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
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  suggestion: VenueSuggestion | null;
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
 * an approved booking. PTR-34: `rejection` is present only on a rejected request, which only the
 * assigned Coordinator is shown.
 */
export interface EventVenueRequest {
  status: string;
  conflict?: "booking" | "hold";
  rejection?: VenueRequestRejection;
  release?: VenueRequestRelease;
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
    status: EventRequestStatus;
    registrationOpensAt?: string | null;
    registrationClosesAt?: string | null;
    expectedAttendance?: number | null;
    layout?: string | null;
    accessibilityRequirements?: string | null;
    requiredFacilities?: string | null;
    registration?: { status: string; registeredAt: string } | null;
    venueRequest?: EventVenueRequest | null;
    equipment?: EquipmentLineProjection[];
  };
}

/**
 * The role-specific projection (PTR-8 criteria 3 and 4). A venue is not part of any branch: none
 * is chosen until a booking exists (PTR-31), and PTR-44 AC2's venue returns with it.
 */
export function projectEvent(
  record: EventRecord,
  access: EventAccess,
  ownRegistration: { status: string; registeredAt: string } | null,
  equipment: EquipmentLineProjection[],
  venueRequest: EventVenueRequest | null
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
          registration: ownRegistration,
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
 * still grants its own staff access), mirroring isVenueQueueRow: an unassigned, newly-requested
 * line of a submitted event is visible to every Technical Support Staff member; once a line is
 * picked up (assignedStaffId set), only that staff member sees it through this row.
 */
export function isEquipmentQueueRow(
  row: { assignedStaffId: string | null; arrangementStatus: string },
  userId: string,
  eventSubmitted: boolean
): boolean {
  // The same shared rule, with the eventSubmitted gate applied only on the unassigned leg: an
  // unassigned `requested` line reaches the queue only once the Coordinator has submitted.
  return (
    isQueueRow(
      { assignedStaffId: row.assignedStaffId, queueStatus: row.arrangementStatus },
      userId,
      "requested"
    ) &&
    (row.assignedStaffId !== null || eventSubmitted)
  );
}
