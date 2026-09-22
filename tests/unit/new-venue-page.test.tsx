import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewVenuePage } from "#/features/venues/components/new-venue-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { VenueValues } from "#/features/venues/schema";

const mockNavigate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

const { saveVenue, onSaveCalls } = vi.hoisted(() => ({
  saveVenue: vi.fn<(options: { data: VenueValues }) => Promise<unknown>>(),
  onSaveCalls: [] as Array<Promise<void>>,
}));

vi.mock("#/features/venues/server-fns", () => ({ saveVenue }));

const VALUES: VenueValues = {
  name: "Seminar Room 2A",
  location: "Level 2",
  maxCapacity: 40,
  facilities: ["Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["classroom"],
  operatingHours: DEFAULT_OPERATING_HOURS,
};

/**
 * The page's only job is to wrap `VenueForm` and turn its `onSave` into the save-then-navigate
 * hand-off; the form's own fields are covered by `venue-form.test.tsx`. Standing the form in as a
 * button that calls the same `onSave` the page passed makes both hand-off outcomes observable.
 */
vi.mock("#/features/venues/components/venue-form", () => ({
  VenueForm: ({
    submitLabel,
    onSave,
  }: {
    submitLabel?: string;
    onSave: (values: VenueValues) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => {
        const save = onSave(VALUES);
        // Observed here so a refusal is not reported as an unhandled rejection while the test is
        // still awaiting the click; the test still asserts on the original promise.
        save.catch(() => undefined);
        onSaveCalls.push(save);
      }}
    >
      {submitLabel}
    </button>
  ),
}));

beforeEach(() => {
  onSaveCalls.length = 0;
});

describe("NewVenuePage", () => {
  it("renders the back link and heading around the create form", () => {
    render(<NewVenuePage />);

    expect(screen.getByRole("link", { name: "Back to venues" }).getAttribute("href")).toBe(
      "/venues"
    );
    expect(screen.getByRole("heading", { name: "New venue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create venue" })).toBeTruthy();
  });

  it("saves the form values and hands off to the new venue's detail route", async () => {
    saveVenue.mockResolvedValue({ id: 42 });
    const user = userEvent.setup();
    render(<NewVenuePage />);

    await user.click(screen.getByRole("button", { name: "Create venue" }));
    await onSaveCalls[0];

    expect(saveVenue).toHaveBeenCalledWith({ data: VALUES });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/venues/$venueId",
      params: { venueId: "42" },
      search: { saved: "true" },
    });
  });

  it("surfaces a refused save and does not navigate", async () => {
    saveVenue.mockRejectedValue(new Error("That name is already taken"));
    const user = userEvent.setup();
    render(<NewVenuePage />);

    await user.click(screen.getByRole("button", { name: "Create venue" }));

    await expect(onSaveCalls[0]).rejects.toThrow("That name is already taken");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
