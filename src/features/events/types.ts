import type { EventAccess } from "./access";

export type { EventAccess };

export interface EventResponse {
  access: EventAccess;
  event: {
    id: string;
    name: string;
    description?: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    venue?: string | null;
    registrationOpensAt?: string | null;
    registrationClosesAt?: string | null;
    expectedAttendance?: number | null;
    layout?: string | null;
    accessibilityRequirements?: string | null;
    requiredFacilities?: string | null;
    registration?: { status: string; registeredAt: string } | null;
    venueRequest?: { status: string } | null;
    equipment?: Array<{ item: string; arrangementStatus: string; notes: string | null }>;
  };
}
