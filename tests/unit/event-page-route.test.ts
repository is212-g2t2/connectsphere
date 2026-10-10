import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route as EventRoute } from "#/routes/_authenticated/events/$eventId";

const { mockLoadEventPageData } = vi.hoisted(() => ({
  mockLoadEventPageData: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("#/features/events/load-page-data", () => ({
  loadEventPageData: mockLoadEventPageData,
}));

type Loader = (args: {
  params: { eventId: string };
  context: { user: { id: string; role: string } };
}) => Promise<unknown>;

describe("event route guard", () => {
  it("redirects no role: every access loads through the same page", () => {
    expect((EventRoute.options as { beforeLoad?: unknown }).beforeLoad).toBeUndefined();
  });
});

describe("event route loader", () => {
  const loader = EventRoute.options.loader as unknown as Loader;
  beforeEach(() => {
    mockLoadEventPageData.mockReset();
  });

  it.each(["abc", "0", "-1", "7.5"])(
    "treats a junk id %s as notFound without a round trip",
    async eventId => {
      await expect(
        loader({ params: { eventId }, context: { user: { id: "u-1", role: "attendee" } } })
      ).rejects.toMatchObject({ isNotFound: true });
      expect(mockLoadEventPageData).not.toHaveBeenCalled();
    }
  );

  it("delegates to loadEventPageData with the parsed id, the caller role and the viewer id", async () => {
    const data = { kind: "event", event: { id: 7 } };
    mockLoadEventPageData.mockResolvedValue(data);

    await expect(
      loader({ params: { eventId: "7" }, context: { user: { id: "u-1", role: "venue_staff" } } })
    ).resolves.toEqual(data);
    expect(mockLoadEventPageData).toHaveBeenCalledWith(7, "venue_staff", "u-1");
  });

  it.each(["attendee", "event_organiser", "venue_staff"])(
    "maps a null page to notFound for %s",
    async role => {
      mockLoadEventPageData.mockResolvedValue(null);

      await expect(
        loader({ params: { eventId: "7" }, context: { user: { id: "u-1", role } } })
      ).rejects.toMatchObject({ isNotFound: true });
    }
  );

  it("lets any other error propagate", async () => {
    mockLoadEventPageData.mockRejectedValue(new Error("connection refused"));

    await expect(
      loader({ params: { eventId: "7" }, context: { user: { id: "u-1", role: "attendee" } } })
    ).rejects.toThrow("connection refused");
  });
});
