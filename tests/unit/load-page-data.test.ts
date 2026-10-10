import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadEventPageData } from "#/features/events/load-page-data";

const {
  mockListEvents,
  mockListEventRegistrations,
  mockGetEventRequest,
  mockGetCoordinationRequest,
  mockListCoordinators,
  mockGetPendingVenueRequest,
  mockListVenueOptions,
  mockListEquipmentTypes,
  mockWarn,
  mockInfo,
} = vi.hoisted(() => ({
  mockListEvents: vi.fn<() => Promise<unknown[]>>(),
  mockListEventRegistrations: vi.fn<() => Promise<unknown[]>>(),
  mockGetEventRequest: vi.fn<() => Promise<unknown>>(),
  mockGetCoordinationRequest: vi.fn<() => Promise<unknown>>(),
  mockListCoordinators: vi.fn<() => Promise<unknown[]>>(),
  mockGetPendingVenueRequest: vi.fn<() => Promise<unknown>>(),
  mockListVenueOptions: vi.fn<() => Promise<unknown[]>>(),
  mockListEquipmentTypes: vi.fn<() => Promise<unknown>>(),
  mockWarn: vi.fn<(...args: unknown[]) => void>(),
  mockInfo: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  listEvents: mockListEvents,
  listEventRegistrations: mockListEventRegistrations,
}));
vi.mock("#/features/event-requests/server-fns", () => ({
  getEventRequest: mockGetEventRequest,
}));
vi.mock("#/features/coordination/server-fns", () => ({
  getCoordinationRequest: mockGetCoordinationRequest,
  listCoordinators: mockListCoordinators,
}));
vi.mock("#/features/venue-requests/server-fns", () => ({
  getPendingVenueRequest: mockGetPendingVenueRequest,
}));
vi.mock("#/features/venues/server-fns", () => ({
  listVenueOptions: mockListVenueOptions,
}));
vi.mock("#/features/equipment-requests/server-fns", () => ({
  listEquipmentTypes: mockListEquipmentTypes,
}));
vi.mock("#/lib/logger", () => ({
  logger: { getChild: () => ({ warn: mockWarn, info: mockInfo }) },
}));

const VIEWER_ID = "viewer-1";

function projection(access: string, event: Record<string, unknown> = {}) {
  return {
    access,
    event: {
      id: 7,
      eventDate: null,
      startTime: null,
      endTime: null,
      status: "submitted",
      ...event,
    },
  };
}

beforeEach(() => {
  for (const mock of [
    mockListEvents,
    mockListEventRegistrations,
    mockGetEventRequest,
    mockGetCoordinationRequest,
    mockListCoordinators,
    mockGetPendingVenueRequest,
    mockListVenueOptions,
    mockListEquipmentTypes,
  ]) {
    mock.mockReset();
  }
  mockWarn.mockReset();
  mockInfo.mockReset();
});

describe("loadEventPageData", () => {
  it("returns an attendee page with no extras", async () => {
    const event = projection("attendee", { status: "confirmed", registrationEnabled: true });
    mockListEvents.mockResolvedValue([event]);

    const data = await loadEventPageData(7, "attendee", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID });
    expect(mockGetEventRequest).not.toHaveBeenCalled();
    expect(mockListEventRegistrations).not.toHaveBeenCalled();
  });

  it("returns null for an attendee event with no page", async () => {
    mockListEvents.mockResolvedValue([projection("attendee", { status: "submitted" })]);

    await expect(loadEventPageData(7, "attendee", VIEWER_ID)).resolves.toBeNull();
  });

  it("returns null when the event is missing", async () => {
    mockListEvents.mockResolvedValue([]);

    await expect(loadEventPageData(7, "attendee", VIEWER_ID)).resolves.toBeNull();
  });

  it("lets a non-Forbidden listEvents error propagate", async () => {
    mockListEvents.mockRejectedValue(new Error("connection refused"));

    await expect(loadEventPageData(7, "attendee", VIEWER_ID)).rejects.toThrow("connection refused");
  });

  it("gathers the organiser extras", async () => {
    const event = projection("organiser", { name: "Open Day", status: "approved" });
    const request = { id: 7, eventName: "Open Day" };
    const attendees = [{ attendeeId: "a-1" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetEventRequest.mockResolvedValue({ request });
    mockListEventRegistrations.mockResolvedValue(attendees);

    const data = await loadEventPageData(7, "event_organiser", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      organiserRequest: request,
      attendees,
    });
    expect(mockGetEventRequest).toHaveBeenCalledWith({ data: { id: 7 } });
    expect(mockListEventRegistrations).toHaveBeenCalledWith({ data: { id: 7 } });
  });

  it("skips the registration fetch for an organiser event with no record", async () => {
    const event = projection("organiser", { name: "Open Day", status: "submitted" });
    const request = { id: 7, eventName: "Open Day" };
    mockListEvents.mockResolvedValue([event]);
    mockGetEventRequest.mockResolvedValue({ request });

    const data = await loadEventPageData(7, "event_organiser", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      organiserRequest: request,
      attendees: undefined,
    });
    expect(mockListEventRegistrations).not.toHaveBeenCalled();
  });

  it("keeps the organiser page when the request read fails", async () => {
    const event = projection("organiser", { name: "Open Day", status: "approved" });
    const attendees = [{ attendeeId: "a-1" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetEventRequest.mockRejectedValue(new Error("request store down"));
    mockListEventRegistrations.mockResolvedValue(attendees);

    const data = await loadEventPageData(7, "event_organiser", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      organiserRequest: null,
      attendees,
    });
  });

  it("keeps the organiser page when the registration read fails", async () => {
    const event = projection("organiser", { name: "Open Day", status: "approved" });
    const request = { id: 7, eventName: "Open Day" };
    mockListEvents.mockResolvedValue([event]);
    mockGetEventRequest.mockResolvedValue({ request });
    mockListEventRegistrations.mockRejectedValue(new Error("registration store down"));

    const data = await loadEventPageData(7, "event_organiser", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      organiserRequest: request,
      attendees: null,
    });
  });

  it("gathers the coordinator extras", async () => {
    const event = projection("coordinator", { name: "Open Day", status: "confirmed" });
    const request = { id: 7, status: "confirmed" };
    const coordinators = [{ id: "c-1" }];
    const attendees = [{ attendeeId: "a-1" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetCoordinationRequest.mockResolvedValue(request);
    mockListCoordinators.mockResolvedValue(coordinators);
    mockListEventRegistrations.mockResolvedValue(attendees);

    const data = await loadEventPageData(7, "event_coordinator", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      coordination: { request, coordinators },
      attendees,
    });
    expect(mockGetCoordinationRequest).toHaveBeenCalledWith({ data: { id: 7 } });
  });

  it("skips the registration fetch for a coordinator event with no record", async () => {
    const event = projection("coordinator", { name: "Open Day", status: "submitted" });
    const request = { id: 7, status: "submitted" };
    const coordinators = [{ id: "c-1" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetCoordinationRequest.mockResolvedValue(request);
    mockListCoordinators.mockResolvedValue(coordinators);

    const data = await loadEventPageData(7, "event_coordinator", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      coordination: { request, coordinators },
      attendees: undefined,
    });
    expect(mockListEventRegistrations).not.toHaveBeenCalled();
  });

  it("keeps the coordinator page when the coordination read fails", async () => {
    const event = projection("coordinator", { name: "Open Day", status: "confirmed" });
    const attendees = [{ attendeeId: "a-1" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetCoordinationRequest.mockRejectedValue(new Error("coordination store down"));
    mockListCoordinators.mockResolvedValue([]);
    mockListEventRegistrations.mockResolvedValue(attendees);

    const data = await loadEventPageData(7, "event_coordinator", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      coordination: null,
      attendees,
    });
  });

  it("gathers the venue decision and the venue options for a pending request", async () => {
    const event = projection("venue_staff", {
      venueRequest: { id: "vr-1", status: "pending", venueName: "Hall A" },
    });
    const request = { id: "vr-1" };
    const venues = [{ id: 3, name: "Hall A" }];
    mockListEvents.mockResolvedValue([event]);
    mockGetPendingVenueRequest.mockResolvedValue(request);
    mockListVenueOptions.mockResolvedValue(venues);

    const data = await loadEventPageData(7, "venue_staff", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      venueDecision: { request, venues },
    });
    expect(mockGetPendingVenueRequest).toHaveBeenCalledWith({ data: { id: "vr-1" } });
  });

  it("offers no venue options to staff without the decide permission", async () => {
    const event = projection("venue_staff", {
      venueRequest: { id: "vr-1", status: "pending", venueName: "Hall A" },
    });
    mockListEvents.mockResolvedValue([event]);
    mockGetPendingVenueRequest.mockResolvedValue({ id: "vr-1" });

    const data = await loadEventPageData(7, "attendee", VIEWER_ID);

    expect(data).toEqual({
      kind: "event",
      event,
      viewerId: VIEWER_ID,
      venueDecision: { request: { id: "vr-1" }, venues: [] },
    });
    expect(mockListVenueOptions).not.toHaveBeenCalled();
  });

  it("skips the decision fetch once the request is decided", async () => {
    const event = projection("venue_staff", {
      venueRequest: { id: "vr-2", status: "approved", venueName: "Hall A" },
    });
    mockListEvents.mockResolvedValue([event]);

    const data = await loadEventPageData(7, "venue_staff", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID });
    expect(mockGetPendingVenueRequest).not.toHaveBeenCalled();
    expect(mockListVenueOptions).not.toHaveBeenCalled();
  });

  it("degrades to no venueDecision when the pending request settles mid-load", async () => {
    const event = projection("venue_staff", {
      venueRequest: { id: "vr-1", status: "pending", venueName: "Hall A" },
    });
    mockListEvents.mockResolvedValue([event]);
    mockGetPendingVenueRequest.mockResolvedValue(null);
    mockListVenueOptions.mockResolvedValue([]);

    const data = await loadEventPageData(7, "venue_staff", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("logs and degrades to no venueDecision when the decision read fails", async () => {
    const event = projection("venue_staff", {
      venueRequest: { id: "vr-1", status: "pending", venueName: "Hall A" },
    });
    mockListEvents.mockResolvedValue([event]);
    mockGetPendingVenueRequest.mockRejectedValue(new Error("venue store down"));

    const data = await loadEventPageData(7, "venue_staff", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID });
    expect(mockWarn).toHaveBeenCalledOnce();
  });

  it("gathers the equipment catalogue for technical support", async () => {
    const event = projection("technical_support", { name: "Open Day" });
    const equipmentTypes = [{ id: 1, name: "Projector" }];
    mockListEvents.mockResolvedValue([event]);
    mockListEquipmentTypes.mockResolvedValue(equipmentTypes);

    const data = await loadEventPageData(7, "technical_support_staff", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID, equipmentTypes });
  });

  it("keeps the page when the equipment catalogue fails", async () => {
    const event = projection("technical_support", { name: "Open Day" });
    mockListEvents.mockResolvedValue([event]);
    mockListEquipmentTypes.mockRejectedValue(new Error("catalogue down"));

    const data = await loadEventPageData(7, "technical_support_staff", VIEWER_ID);

    expect(data).toEqual({ kind: "event", event, viewerId: VIEWER_ID, equipmentTypes: null });
  });

  it("falls back to the coordinator triage view for an unassigned request", async () => {
    mockListEvents.mockRejectedValue(new Error("Forbidden"));
    const request = { id: 7, status: "submitted" };
    const coordinators = [{ id: "c-1" }];
    mockGetCoordinationRequest.mockResolvedValue(request);
    mockListCoordinators.mockResolvedValue(coordinators);

    const data = await loadEventPageData(7, "event_coordinator", VIEWER_ID);

    expect(data).toEqual({ kind: "triage", viewerId: VIEWER_ID, request, coordinators });
    expect(mockGetCoordinationRequest).toHaveBeenCalledWith({ data: { id: 7 } });
  });

  it("returns null on Forbidden for a role that cannot coordinate", async () => {
    mockListEvents.mockRejectedValue(new Error("Forbidden"));

    await expect(loadEventPageData(7, "attendee", VIEWER_ID)).resolves.toBeNull();
    expect(mockGetCoordinationRequest).not.toHaveBeenCalled();
  });

  it("returns null when the triage fallback is refused", async () => {
    mockListEvents.mockRejectedValue(new Error("Forbidden"));
    mockGetCoordinationRequest.mockRejectedValue(new Error("Forbidden"));
    mockListCoordinators.mockResolvedValue([]);

    await expect(loadEventPageData(7, "event_coordinator", VIEWER_ID)).resolves.toBeNull();
  });

  it("rethrows a non-refusal triage failure", async () => {
    mockListEvents.mockRejectedValue(new Error("Forbidden"));
    mockGetCoordinationRequest.mockRejectedValue(new Error("coordination store down"));
    mockListCoordinators.mockResolvedValue([]);

    await expect(loadEventPageData(7, "event_coordinator", VIEWER_ID)).rejects.toThrow(
      "coordination store down"
    );
  });
});
