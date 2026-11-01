// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pencil } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { IconAction, IconActionLink } from "#/components/ui/icon-action";

describe("IconAction", () => {
  it("names the icon-only button with its label and keeps the label out of its content", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    render(<IconAction label="Rename" icon={<Pencil />} onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Rename" });
    expect(button.textContent).not.toContain("Rename");

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the label as a tooltip on hover", async () => {
    const user = userEvent.setup();
    render(<IconAction label="Rename" icon={<Pencil />} />);

    await user.hover(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("Rename")).toBeTruthy();
  });

  it("shows the label as a tooltip on keyboard focus and keeps its danger tone", async () => {
    const user = userEvent.setup();
    render(<IconAction label="Delete" icon={<Pencil />} tone="danger" />);

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.className).toContain("text-destructive");
    expect(button.classList.contains("border-destructive")).toBe(false);
    expect(button.classList.contains("border-input")).toBe(false);

    await user.tab();
    expect(document.activeElement).toBe(button);
    expect(await screen.findByText("Delete")).toBeTruthy();
  });

  it("renders no border or outline chrome at rest", () => {
    render(<IconAction label="Rename" icon={<Pencil />} />);

    const button = screen.getByRole("button", { name: "Rename" });
    for (const chrome of ["border-destructive", "border-input", "bg-primary", "bg-destructive"]) {
      expect(button.classList.contains(chrome)).toBe(false);
    }
  });

  it("names the icon link with its label and tooltips it the same way", async () => {
    const user = userEvent.setup();
    render(
      <IconActionLink
        label="Resume"
        icon={<Pencil />}
        link={<a href="/event-requests/reopenDraft/41" aria-label="Resume" />}
      />
    );

    const link = screen.getByRole("link", { name: "Resume" });
    expect(link.getAttribute("href")).toBe("/event-requests/reopenDraft/41");

    await user.hover(link);
    expect(await screen.findByText("Resume")).toBeTruthy();
  });
});
