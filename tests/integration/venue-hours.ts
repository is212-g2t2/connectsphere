import type { OperatingHours } from "#/features/venues/schema";

/**
 * Opening hours for a fixture venue that opens 08:00–22:00 on every day of the week. Use it when
 * a test puts requests on a weekend and is not about opening hours. A pending request outside the
 * hours is flagged as unavailable (PTR-138 AC1).
 */
export const OPEN_EVERY_DAY: OperatingHours = {
  mon: { opens: "08:00", closes: "22:00" },
  tue: { opens: "08:00", closes: "22:00" },
  wed: { opens: "08:00", closes: "22:00" },
  thu: { opens: "08:00", closes: "22:00" },
  fri: { opens: "08:00", closes: "22:00" },
  sat: { opens: "08:00", closes: "22:00" },
  sun: { opens: "08:00", closes: "22:00" },
};
