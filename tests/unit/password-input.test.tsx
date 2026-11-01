// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "#/features/auth/components/password-input";

function RuledInput() {
  const [value, setValue] = useState("");
  return (
    <PasswordInput id="password" showRules value={value} onChange={e => setValue(e.target.value)} />
  );
}

describe("PasswordInput", () => {
  it("starts hidden and toggles the field type on reveal", async () => {
    const visitor = userEvent.setup();
    render(<PasswordInput id="password" />);

    const field = document.getElementById("password");
    expect(field?.getAttribute("type")).toBe("password");

    await visitor.click(screen.getByRole("button", { name: "Show password" }));
    expect(field?.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("never submits the form from the reveal button", () => {
    render(<PasswordInput id="password" />);

    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("type")).toBe(
      "button"
    );
  });

  it("wires the rule checklist to the field and checks each rule live", async () => {
    const visitor = userEvent.setup();
    render(<RuledInput />);

    const field = document.getElementById("password");
    if (!(field instanceof HTMLInputElement)) throw new Error("Password field did not render");
    const list = screen.getByRole("list", { name: "Password rules" });
    expect(field.getAttribute("aria-describedby")).toContain(list.getAttribute("id"));

    const items = () => list.querySelectorAll("li");
    expect(items()[0].getAttribute("data-valid")).toBe("false");
    expect(items()[1].getAttribute("data-valid")).toBe("false");
    expect(items()[2].getAttribute("data-valid")).toBe("false");

    await visitor.type(field, "Secret99!");
    expect(items()[0].getAttribute("data-valid")).toBe("true");
    expect(items()[1].getAttribute("data-valid")).toBe("true");
    expect(items()[2].getAttribute("data-valid")).toBe("true");
  });

  it("shows no checklist unless asked", () => {
    render(<PasswordInput id="password" />);

    expect(screen.queryByRole("list", { name: "Password rules" })).toBeNull();
  });
});
