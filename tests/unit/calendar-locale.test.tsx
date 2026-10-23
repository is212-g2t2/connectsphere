import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultLocale } from "react-day-picker";

import { Calendar } from "#/components/ui/calendar";

/**
 * The calendar pins `en-GB` so a day reads the same on the server and after hydration.
 * Render to static markup, as the server does. jsdom would use the test runner's locale
 * instead and prove nothing.
 */
describe("Calendar locale pin", () => {
  it("renders data-day in en-GB so SSR and hydration match", () => {
    const html = renderToStaticMarkup(
      <Calendar
        mode="single"
        month={new Date("2026-10-05T00:00:00Z")}
        selected={new Date("2026-10-05T00:00:00Z")}
      />
    );
    expect(html).toContain('data-day="05/10/2026"');
  });

  it("labels the month in en-GB", () => {
    const html = renderToStaticMarkup(<Calendar month={new Date("2026-10-05T00:00:00Z")} />);
    expect(html).toContain("October");
  });

  it("outlines range endpoints instead of filling them", () => {
    const html = renderToStaticMarkup(
      <Calendar
        mode="range"
        month={new Date("2026-10-05T00:00:00Z")}
        selected={{
          from: new Date("2026-10-05T00:00:00Z"),
          to: new Date("2026-10-07T00:00:00Z"),
        }}
      />
    );
    expect(html).toContain("ring-primary");
  });

  it("formats the month dropdown in the calendar locale", () => {
    const html = renderToStaticMarkup(
      <Calendar
        captionLayout="dropdown"
        month={new Date("2026-10-05T00:00:00Z")}
        startMonth={new Date("2026-01-01T00:00:00Z")}
        endMonth={new Date("2026-12-31T00:00:00Z")}
        locale={{ ...defaultLocale, code: "de-DE" }}
      />
    );
    expect(html).toContain("Okt");
  });
});
