import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route as ReviewRoute } from "#/routes/_authenticated/equipment-requests/$eventId";
import { Route as WorkListRoute } from "#/routes/_authenticated/equipment-requests/index";

const { mockListEvents, mockListEquipmentTypes } = vi.hoisted(() => ({
  mockListEvents: vi.fn<() => Promise<unknown[]>>(),
  mockListEquipmentTypes: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("#/features/events/server-fns", () => ({ listEvents: mockListEvents }));
vi.mock("#/features/equipment-requests/server-fns", () => ({
  listEquipmentTypes: mockListEquipmentTypes,
}));

type Guard = (args: { context: { user: { role: string } } }) => void;
type Loader = (args: { params: { eventId: string } }) => Promise<unknown>;

const routes = [
  ["work list", WorkListRoute],
  ["review", ReviewRoute],
] as const;

describe.each(routes)("%s route guard", (_name, route) => {
  const beforeLoad = route.options.beforeLoad as unknown as Guard;

  it.each(["attendee", "event_organiser", "event_coordinator", "venue_staff"])(
    "redirects %s to /dashboard",
    role => {
      expect(() => beforeLoad({ context: { user: { role } } })).toThrow(
        expect.objectContaining({ options: expect.objectContaining({ to: "/dashboard" }) })
      );
    }
  );

  it("lets technical support through", () => {
    expect(() =>
      beforeLoad({ context: { user: { role: "technical_support_staff" } } })
    ).not.toThrow();
  });
});

describe("review route loader", () => {
  const loader = ReviewRoute.options.loader as unknown as Loader;
  beforeEach(() => {
    mockListEvents.mockReset();
    mockListEquipmentTypes.mockReset();
    mockListEquipmentTypes.mockResolvedValue([]);
  });

  it.each(["Forbidden", "Not Found"])("turns a %s refusal into notFound", async message => {
    mockListEvents.mockImplementation(async () => {
      throw new Error(message);
    });
    await expect(loader({ params: { eventId: "7" } })).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it("lets any other error propagate", async () => {
    mockListEvents.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    await expect(loader({ params: { eventId: "7" } })).rejects.toThrow("connection refused");
  });

  it("still resolves with an empty catalogue when listing types fails", async () => {
    mockListEvents.mockResolvedValue([{ event: { id: 7 } }]);
    mockListEquipmentTypes.mockRejectedValue(new Error("catalogue down"));
    await expect(loader({ params: { eventId: "7" } })).resolves.toEqual({
      event: { id: 7 },
      equipmentTypes: [],
    });
  });
});
