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
 * The shared venue queue (PTR-31): a Venue Staff member works the rows assigned to them, plus
 * every unassigned `pending` one. `records.server.ts` scopes its event-list query with the same
 * rule in SQL and calls this for its in-memory readers, so the rule has one home. It carries no
 * `#/db` import — this module is client-reachable.
 */
export function isVenueQueueRow(
  row: { assignedStaffId: string | null; status: string },
  userId: string
): boolean {
  return row.assignedStaffId === null ? row.status === "pending" : row.assignedStaffId === userId;
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
  status: string;
  proposedDates: Array<{ start?: string; end?: string }>;
  expectedAttendance: number | null;
  roomLayoutPreference: string;
  accessibilityRequirements: string;
  venueRequirements: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
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
    status?: string;
    registrationOpensAt?: string | null;
    registrationClosesAt?: string | null;
    expectedAttendance?: number | null;
    layout?: string | null;
    accessibilityRequirements?: string | null;
    requiredFacilities?: string | null;
    registration?: { status: string; registeredAt: string } | null;
    venueRequest?: { status: string } | null;
    equipment?: Array<{
      id: string;
      item: string;
      arrangementStatus: string;
      notes: string | null;
    }>;
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
  equipment: Array<{ id: string; item: string; arrangementStatus: string; notes: string | null }>,
  venueRequest: { status: string } | null
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
          registrationOpensAt: record.registrationOpensAt,
          registrationClosesAt: record.registrationClosesAt,
          registration: ownRegistration,
        },
      };

    // PTR-31 criterion 2: event timing, expected attendance, layout, accessibility and required
    // facilities — and no other event information, so not even the name.
    case "venue_staff":
      return {
        access,
        event: {
          id: record.id,
          ...timing,
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
          equipment,
          venueRequest,
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
