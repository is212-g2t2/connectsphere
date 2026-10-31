// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { DEFAULT_OPERATING_HOURS, INITIAL_ROOM_LAYOUTS } from "#/features/venues/schema";
import type { SessionUser } from "#/features/auth/session";
import type { Venue } from "#/features/venues/server-fns";

/** PTR-75 criterion 4: page views must render without a router. The views used to live in route
 * files and call `Route.useRouteContext()`. Tests then needed a router, memory history, and route
 * tree. Views now take route data as props. Mock the venue page's `navigate` and `invalidate`
 * hooks, as `login-form.test.tsx` does for forms.
 */
const { routerInvalidate } = vi.hoisted(() => ({
  routerInvalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  // Compose params and search so tests can read each link's destination.
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | number>;
    [key: string]: unknown;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    const query = new URLSearchParams(
      Object.entries(search ?? {}).map(([key, value]) => [key, String(value)])
    ).toString();
    return (
      <a href={query ? `${href}?${query}` : href} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate: routerInvalidate }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function userWithRole(role: string): SessionUser {
  return { id: "usr_1", email: "casey@example.com", name: "Casey", role };
}

const venue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  setupMinutes: 0,
  turnaroundMinutes: 0,
  facilities: ["Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre", "banquet"],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const smallRoom: Venue = {
  ...venue,
  id: 8,
  name: "Small Room",
  location: "West Wing",
  maxCapacity: 40,
  facilities: ["Whiteboard"],
  supportedLayouts: ["boardroom"],
};

function catalogueResult(venues: Venue[]) {
  return {
    event: null,
    filters: {},
    venues,
    unsuitable: [],
    layouts: [...INITIAL_ROOM_LAYOUTS],
  };
}

describe("VenueListPage", () => {
  it("lists the loaded venues with their layouts spelled out", () => {
    render(
      <VenueListPage
        user={userWithRole("event_coordinator")}
        result={{
          event: null,
          filters: {},
          venues: [venue],
          unsuitable: [],
          layouts: [...INITIAL_ROOM_LAYOUTS],
        }}
      />
    );

    // The name links twice: once in the mobile card, once in the desktop table.
    expect(screen.getAllByRole("link", { name: "Great Hall" })).toHaveLength(2);
    expect(screen.getAllByText("Theatre, Banquet")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "New venue" })).toBeNull();
  });

  it("offers the create link only to a role holding venue:create", () => {
    render(
      <VenueListPage
        user={userWithRole("venue_staff")}
        result={{
          event: null,
          filters: {},
          venues: [],
          unsuitable: [],
          layouts: [...INITIAL_ROOM_LAYOUTS],
        }}
      />
    );

    expect(screen.getByText("No venues recorded yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New venue" })).toBeTruthy();
  });

  it.each(["venue_staff", "technical_support_staff"])(
    "shows %s the catalogue without the search form or its description",
    role => {
      render(
        <VenueListPage
          user={userWithRole(role)}
          result={{
            event: null,
            filters: {},
            venues: [venue],
            unsuitable: [],
            layouts: [...INITIAL_ROOM_LAYOUTS],
          }}
        />
      );

      expect(screen.getByRole("region", { name: "Venue results" })).toBeTruthy();
      expect(screen.getAllByRole("link", { name: "Great Hall" })).toHaveLength(2);
      expect(
        screen.getByText("ConnectSphere's rooms and spaces, and what each one offers.")
      ).toBeTruthy();
      expect(screen.queryByText("Search venues")).toBeNull();
      expect(
        screen.queryByText("Every result must satisfy every requirement you apply.")
      ).toBeNull();
      expect(
        screen.queryByText(
          "Search ConnectSphere's rooms and spaces against an event's hard requirements."
        )
      ).toBeNull();
    }
  );
});

describe("VenueListPage catalogue", () => {
  it("filters the catalogue by name or location", async () => {
    const actor = userEvent.setup();
    render(
      <VenueListPage
        user={userWithRole("venue_staff")}
        result={catalogueResult([venue, smallRoom])}
      />
    );

    const filter = screen.getByLabelText("Filter venues");
    await actor.type(filter, "west");

    expect(screen.queryByRole("link", { name: "Great Hall" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Small Room" })).toHaveLength(2);
    expect(screen.getByText("1 of 2 venues")).toBeTruthy();

    await actor.clear(filter);
    expect(screen.getAllByRole("link", { name: "Great Hall" })).toHaveLength(2);
  });

  it("shows an explicit empty result for a filter that matches nothing", async () => {
    const actor = userEvent.setup();
    render(<VenueListPage user={userWithRole("venue_staff")} result={catalogueResult([venue])} />);

    await actor.type(screen.getByLabelText("Filter venues"), "nowhere");

    expect(screen.getByText("No venues match this filter.")).toBeTruthy();
  });

  it("sorts the catalogue by name, then by capacity", async () => {
    const actor = userEvent.setup();
    render(
      <VenueListPage
        user={userWithRole("venue_staff")}
        result={catalogueResult([venue, smallRoom])}
      />
    );

    const results = screen.getByRole("region", { name: "Venue results" });
    const names = () =>
      within(results)
        .getAllByRole("link", { name: /^(Great Hall|Small Room)$/ })
        .map(link => link.textContent);

    // DOM order is the mobile cards, then the desktop table rows.
    expect(names()).toEqual(["Great Hall", "Small Room", "Great Hall", "Small Room"]);

    await actor.selectOptions(screen.getByLabelText("Sort venues"), "capacity");
    expect(names()).toEqual(["Small Room", "Great Hall", "Small Room", "Great Hall"]);
  });

  it("offers Venue Staff a visible Edit action on each catalogue row", () => {
    render(<VenueListPage user={userWithRole("venue_staff")} result={catalogueResult([venue])} />);

    const edits = screen.getAllByRole("link", { name: "Edit" });
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.getAttribute("href")).toBe("/venues/7");
    }
  });

  it("offers no Edit action to a role that cannot update venues", () => {
    render(
      <VenueListPage
        user={userWithRole("technical_support_staff")}
        result={catalogueResult([venue])}
      />
    );

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });
});
