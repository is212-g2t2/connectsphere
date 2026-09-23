import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "#/features/auth/session";
import { ClarificationReplyForm } from "#/features/event-requests/components/clarification-reply-form";

const { replyToClarification, invalidate } = vi.hoisted(() => ({
  replyToClarification: vi.fn<(input: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({ replyToClarification }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));

describe("ClarificationReplyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits a trimmed explanation-only reply and refreshes the request", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    await user.type(screen.getByLabelText("Your reply"), "  The venue is wheelchair accessible.  ");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(replyToClarification).toHaveBeenCalledWith({
        data: {
          id: 7,
          clarificationId: 14,
          body: "The venue is wheelchair accessible.",
          amendments: {},
        },
      });
      expect(invalidate).toHaveBeenCalledOnce();
    });
  });

  it("allows amendments only for the fields named by the clarification", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["expectedAttendance"] }}
        initialValues={{
          eventName: "Annual Gala",
          purpose: "Fundraiser",
          proposedDates: [],
          expectedAttendance: 100,
          description: "",
          eventType: "",
          venueRequirements: "",
          roomLayoutPreference: "",
          accessibilityRequirements: "",
          equipmentRequirements: [],
          specialArrangements: "",
          registrationEnabled: false,
        }}
      />
    );

    expect(screen.getByLabelText("Event name (required)").getAttribute("disabled")).toBe("");
    const attendance = screen.getByLabelText("Expected attendance (required)");
    expect(attendance.getAttribute("disabled")).toBeNull();

    await user.clear(attendance);
    await user.type(attendance, "120");
    await user.type(screen.getByLabelText("Your reply"), "The revised count is confirmed.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(replyToClarification).toHaveBeenCalledWith({
        data: {
          id: 7,
          clarificationId: 14,
          body: "The revised count is confirmed.",
          amendments: { expectedAttendance: 120 },
        },
      });
    });
  });

  it("keeps the reply and permitted amendments after a native conflict", async () => {
    const user = userEvent.setup();
    replyToClarification.mockRejectedValueOnce(
      new ConflictError("This clarification can no longer be replied to.")
    );

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["expectedAttendance"] }}
        initialValues={{
          eventName: "Annual Gala",
          purpose: "Fundraiser",
          proposedDates: [],
          expectedAttendance: 100,
          description: "",
          eventType: "",
          venueRequirements: "",
          roomLayoutPreference: "",
          accessibilityRequirements: "",
          equipmentRequirements: [],
          specialArrangements: "",
          registrationEnabled: false,
        }}
      />
    );

    const reply = screen.getByLabelText("Your reply");
    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(attendance, "120");
    await user.type(reply, "The latest capacity is 120.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(replyToClarification).toHaveBeenCalledWith({
        data: {
          id: 7,
          clarificationId: 14,
          body: "The latest capacity is 120.",
          amendments: { expectedAttendance: 120 },
        },
      });
      expect(screen.getByRole("alert").textContent).toContain(
        "This clarification can no longer be replied to."
      );
    });
    expect((reply as HTMLTextAreaElement).value).toBe("The latest capacity is 120.");
    expect((attendance as HTMLInputElement).value).toBe("120");
  });

  it("surfaces a delivery warning after a saved reply", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "failed",
    });

    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    await user.type(screen.getByLabelText("Your reply"), "The latest capacity is 120.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Your reply was saved, but ConnectSphere could not notify the Coordinator."
      );
    });
  });

  it("locks the form after a saved reply when route invalidation fails", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });
    invalidate.mockRejectedValueOnce(new Error("Route reload failed"));

    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    await user.type(screen.getByLabelText("Your reply"), "The latest capacity is 120.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    const savedButton = await screen.findByRole("button", { name: "Reply sent" });
    expect((savedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Your reply was saved. Refresh this page to see the updated request."
    );

    await user.click(savedButton);
    expect(replyToClarification).toHaveBeenCalledOnce();
  });
});
