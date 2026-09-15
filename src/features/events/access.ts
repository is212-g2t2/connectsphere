export type EventAccess =
  | "organiser"
  | "coordinator"
  | "venue_staff"
  | "technical_support"
  | "attendee";

export interface EventAccessInput {
  role: string | null | undefined;
  userId: string;
  createdById: string;
  coordinatorIds: string[];
  venueStaffIds: string[];
  technicalSupportIds: string[];
  isPublishedForRegistration: boolean;
  hasOwnRegistration: boolean;
}

export function getEventAccess(input: EventAccessInput): EventAccess | null {
  if (input.role === "event_organiser" && input.createdById === input.userId) return "organiser";
  if (input.role === "event_coordinator" && input.coordinatorIds.includes(input.userId))
    return "coordinator";
  if (input.role === "venue_staff" && input.venueStaffIds.includes(input.userId))
    return "venue_staff";
  if (
    input.role === "technical_support_staff" &&
    input.technicalSupportIds.includes(input.userId)
  ) {
    return "technical_support";
  }
  if (input.role === "attendee" && (input.isPublishedForRegistration || input.hasOwnRegistration))
    return "attendee";
  return null;
}

export interface EventBaseFields {
  id: string;
  name: string;
  description: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  venue: string | null;
  status: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
}

export interface EventPlanningFields {
  expectedAttendance: number | null;
  layout: string | null;
  accessibilityRequirements: string | null;
  requiredFacilities: string | null;
}

export function projectEvent(
  event: EventBaseFields & EventPlanningFields,
  access: EventAccess,
  ownRegistration?: { status: string; registeredAt: string } | null,
  equipment?: Array<{ item: string; arrangementStatus: string; notes: string | null }>,
  venueRequest?: { status: string } | null
) {
  if (access === "attendee") {
    return {
      access,
      event: {
        id: event.id,
        name: event.name,
        description: event.description,
        eventDate: event.eventDate,
        startTime: event.startTime,
        endTime: event.endTime,
        venue: event.venue,
        registrationOpensAt: event.registrationOpensAt,
        registrationClosesAt: event.registrationClosesAt,
        registration: ownRegistration ?? null,
      },
    };
  }

  if (access === "venue_staff") {
    return {
      access,
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate,
        startTime: event.startTime,
        endTime: event.endTime,
        venue: event.venue,
        expectedAttendance: event.expectedAttendance,
        layout: event.layout,
        accessibilityRequirements: event.accessibilityRequirements,
        requiredFacilities: event.requiredFacilities,
        venueRequest: venueRequest ?? null,
      },
    };
  }

  if (access === "technical_support") {
    return {
      access,
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate,
        startTime: event.startTime,
        endTime: event.endTime,
        equipment: equipment ?? [],
      },
    };
  }

  return {
    access,
    event: { ...event, equipment: equipment ?? [], venueRequest: venueRequest ?? null },
  };
}
