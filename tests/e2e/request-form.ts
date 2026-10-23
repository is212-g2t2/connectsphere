import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Strip the required/optional suffix to get the field's bare label. */
function bareLabel(label: string): string {
  return label.replace(/ \((?:required|optional)\)$/u, "");
}

/**
 * Pick one dropdown value. A value that is not in the list is kept through the Other item and
 * its text input, so a legacy value still round-trips.
 */
export async function chooseSelectValue(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  const other = page.getByRole("option", { name: "Other", exact: true });
  await other.waitFor();
  const option = page.getByRole("option", { name: value, exact: true });
  if ((await option.count()) > 0) {
    await option.click();
    await expect(page.getByRole("combobox", { name: label })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    return;
  }
  await other.click();
  await expect(page.getByRole("combobox", { name: label })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await page.getByLabel(`${bareLabel(label)}: other`).fill(value);
}

/**
 * Tick one checkbox group option. A value that is not in the list is kept through the group's
 * Other checkbox and its text box.
 */
export async function chooseGroupValue(page: Page, legend: string, value: string): Promise<void> {
  const group = page.getByRole("group", { name: legend });
  const option = group.getByRole("checkbox", { name: value, exact: true });
  if ((await option.count()) > 0) {
    await option.click();
    await expect(option).toBeChecked();
    return;
  }
  const other = group.getByRole("checkbox", { name: "Other", exact: true });
  await other.click();
  await expect(other).toBeChecked();
  await page.getByLabel(`${bareLabel(legend)}: other`).fill(value);
  await expect(other).toBeChecked();
}
