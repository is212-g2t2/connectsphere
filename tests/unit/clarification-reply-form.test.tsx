import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError } from "#/features/auth/session";
import { ClarificationReplyForm } from "#/features/event-requests/components/clarification-reply-form";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";

const { replyToClarification, invalidate, success, warning } = vi.hoisted(() => ({
  replyToClarification: vi.fn<(input: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({ replyToClarification }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("sonner", () => ({ toast: { success, warning } }));

const initialValues: EventRequestDraftValues = {
  eventName: "Annual Gala",
  purpose: "Fundraiser",
  proposedDates: [],
  expectedAttendance: 100,
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "Theatre",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
  registrationEnabled: false,
};

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

    await user.type(
      screen.getByLabelText("Your reply (required)"),
      "  The venue is wheelchair accessible.  "
    );
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

  it("confirms a sent reply to the organiser", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    await user.type(
      screen.getByLabelText("Your reply (required)"),
      "The venue is wheelchair accessible."
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(success).toHaveBeenCalledWith("Reply sent — the Coordinator has been notified.");
    });
  });

  it("refuses an empty reply at the textarea and calls no server function", async () => {
    const user = userEvent.setup();

    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(await screen.findByText("Enter your reply")).toBeTruthy();
    expect(screen.getByLabelText("Your reply (required)").getAttribute("aria-invalid")).toBe(
      "true"
    );
    expect(replyToClarification).not.toHaveBeenCalled();
  });

  it("sends only the permitted fields the organiser changed", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{
          id: 14,
          permittedFields: ["expectedAttendance", "roomLayoutPreference"],
        }}
        initialValues={initialValues}
      />
    );

    expect(screen.getByLabelText("Event name (required)").getAttribute("disabled")).toBe("");
    const attendance = screen.getByLabelText("Expected attendance (required)");
    expect(attendance.getAttribute("disabled")).toBeNull();

    await user.clear(attendance);
    await user.type(attendance, "120");
    await user.type(
      screen.getByLabelText("Your reply (required)"),
      "The revised count is confirmed."
    );
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(replyToClarification).toHaveBeenCalledWith({
        data: {
          id: 7,
          clarificationId: 14,
          body: "The revised count is confirmed.",
          // The untouched room layout is omitted so it cannot revert a value another reply set.
          amendments: { expectedAttendance: 120 },
        },
      });
    });
  });

  it("refuses a cleared permitted required field at its own control", async () => {
    const user = userEvent.setup();

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["expectedAttendance"] }}
        initialValues={initialValues}
      />
    );

    const attendance = screen.getByLabelText("Expected attendance (required)");
    await user.clear(attendance);
    await user.type(screen.getByLabelText("Your reply (required)"), "The count needs revising.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(attendance.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Expected attendance is required");
    expect(replyToClarification).not.toHaveBeenCalled();
  });

  it("does not refuse a locked required field the Coordinator did not permit", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["expectedAttendance"] }}
        initialValues={{ ...initialValues, purpose: "" }}
      />
    );

    await user.type(screen.getByLabelText("Your reply (required)"), "The purpose is unchanged.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(replyToClarification).toHaveBeenCalledOnce());
  });

  it("sends the four registration values as a group when any of them changed", async () => {
    const user = userEvent.setup();
    replyToClarification.mockResolvedValueOnce({
      clarification: { id: 14 },
      notification: "sent",
    });

    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["attendeeRegistration"] }}
        initialValues={initialValues}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Require attendee registration" }));
    await user.type(screen.getByLabelText("Registration capacity (required)"), "50");
    await user.type(screen.getByLabelText("Registration opens (required)"), "2030-11-01T09:00");
    await user.type(screen.getByLabelText("Registration closes (required)"), "2030-11-08T17:00");
    await user.type(screen.getByLabelText("Your reply (required)"), "Registration is now open.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(replyToClarification).toHaveBeenCalledWith({
        data: {
          id: 7,
          clarificationId: 14,
          body: "Registration is now open.",
          amendments: {
            registrationEnabled: true,
            registrationCapacity: 50,
            registrationOpensAt: "2030-11-01T09:00",
            registrationClosesAt: "2030-11-08T17:00",
          },
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
        initialValues={initialValues}
      />
    );

    const reply = screen.getByLabelText("Your reply (required)");
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

    await user.type(screen.getByLabelText("Your reply (required)"), "The latest capacity is 120.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "Your reply was saved, but ConnectSphere could not notify the Coordinator."
      );
      expect(warning).toHaveBeenCalledWith(
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

    await user.type(screen.getByLabelText("Your reply (required)"), "The latest capacity is 120.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    const savedButton = await screen.findByRole("button", { name: "Reply sent" });
    expect((savedButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Your reply was saved. Refresh this page to see the updated request."
    );

    await user.click(savedButton);
    expect(replyToClarification).toHaveBeenCalledOnce();
  });

  it("marks the reply required and drops the field guidance when nothing is permitted", async () => {
    render(
      <ClarificationReplyForm requestId={7} clarification={{ id: 14, permittedFields: [] }} />
    );

    const reply = screen.getByLabelText("Your reply (required)");
    expect(reply.getAttribute("required")).not.toBeNull();
    expect(screen.queryByText(/Only the fields selected by the Coordinator/)).toBeNull();
  });

  it("shows the field guidance when the Coordinator permitted a field", async () => {
    render(
      <ClarificationReplyForm
        requestId={7}
        clarification={{ id: 14, permittedFields: ["expectedAttendance"] }}
        initialValues={initialValues}
      />
    );

    expect(screen.getByText(/Only the fields selected by the Coordinator/)).toBeTruthy();
  });
});
