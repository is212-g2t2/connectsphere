import { describe, expect, it } from "vitest";
import { parseClarificationBody, parseClarificationReply } from "#/features/event-requests/schema";

describe("Clarification reply input", () => {
  it("requires a trimmed reply of 1 to 2000 characters and positive request and question ids", () => {
    expect(
      parseClarificationReply({ id: 1, clarificationId: 2, body: "  Confirmed\n120 guests  " })
    ).toEqual({ id: 1, clarificationId: 2, body: "Confirmed\n120 guests", amendments: {} });
    for (const body of ["", " \n ", "a".repeat(2001)]) {
      expect(() => parseClarificationReply({ id: 1, clarificationId: 2, body })).toThrow(
        body.trim() ? "Reply must be 2000 characters or fewer" : "Enter your reply"
      );
    }
    for (const body of ["a", "a".repeat(2000)]) {
      expect(parseClarificationReply({ id: 1, clarificationId: 2, body }).body).toBe(body);
    }
    for (const id of [0, -1, 1.5, 2147483648, "1", undefined]) {
      expect(() => parseClarificationReply({ id, clarificationId: 2, body: "Yes" })).toThrow(
        /Too small|Too big|Invalid input/
      );
      expect(() => parseClarificationReply({ id: 1, clarificationId: id, body: "Yes" })).toThrow(
        /Too small|Too big|Invalid input/
      );
    }
  });

  it("keeps per-question scopes independent and treats legacy questions as reply-only", () => {
    expect(parseClarificationBody({ id: 7, body: "Explain the layout" })).toMatchObject({
      id: 7,
      body: "Explain the layout",
      permittedFields: [],
    });
    expect(
      parseClarificationBody({
        id: 7,
        body: "Confirm attendance",
        permittedFields: ["expectedAttendance", "roomLayoutPreference"],
      }).permittedFields
    ).toEqual(["expectedAttendance", "roomLayoutPreference"]);
    expect(
      parseClarificationBody({
        id: 7,
        body: "Confirm equipment",
        permittedFields: ["equipmentRequirements"],
      }).permittedFields
    ).toEqual(["equipmentRequirements"]);
    expect(() =>
      parseClarificationBody({
        id: 7,
        body: "Forged scope",
        permittedFields: ["ownerId"],
      })
    ).toThrow("Invalid option");
  });

  it("rejects forged owner, status, assignment, and permitted-field data at the outer boundary", () => {
    for (const forged of [
      { ownerId: "organiser-2" },
      { status: "approved" },
      { assignedCoordinatorId: "coordinator-2" },
      { permittedFields: ["expectedAttendance"] },
    ]) {
      expect(() =>
        parseClarificationReply({
          id: 1,
          clarificationId: 2,
          body: "Confirmed",
          ...forged,
        })
      ).toThrow("Unrecognized key");
    }
  });
});
