import { describe, expect, it } from "vitest";

import {
  EVENT_REQUEST_STATUSES,
  canUpdateEventInformation,
  eventInformationLockedMessage,
  parseEventInformationInput,
} from "#/features/event-requests/schema";

const complete = {
  id: 7,
  eventName: "Planning forum",
  purpose: "Agree the plan",
  proposedDates: [{ start: "2031-03-10T09:00", end: "2031-03-10T17:00" }],
  expectedAttendance: 80,
};

describe("event information updates (PTR-22)", () => {
  it("opens only approved, planning and confirmed events to an update (AC2)", () => {
    expect(EVENT_REQUEST_STATUSES.filter(canUpdateEventInformation)).toEqual([
      "approved",
      "planning",
      "confirmed",
    ]);
  });

  it("names the status that refuses the update in plain language", () => {
    expect(eventInformationLockedMessage("completed")).toBe(
      "This event's information cannot be updated while its status is completed."
    );
    expect(eventInformationLockedMessage("under_review")).toBe(
      "This event's information cannot be updated while its status is under review."
    );
  });

  it("parses a complete record with its event id", () => {
    expect(parseEventInformationInput(complete)).toMatchObject({
      ...complete,
      registrationEnabled: false,
      equipmentRequirements: [],
    });
  });

  it("requires the event id", () => {
    const { id: _id, ...withoutId } = complete;

    expect(() => parseEventInformationInput(withoutId)).toThrow("Choose an event request");
  });

  it("refuses a record that is missing what a submitted event needs", () => {
    expect(() =>
      parseEventInformationInput({ ...complete, purpose: "", expectedAttendance: undefined })
    ).toThrow("This request is missing: Purpose, Expected attendance");
    expect(() =>
      parseEventInformationInput({
        ...complete,
        equipmentRequirements: [{ type: "Projector" }],
      })
    ).toThrow("This request is missing: Equipment requirements");
  });

  it("drops the registration terms when registration is off", () => {
    expect(
      parseEventInformationInput({
        ...complete,
        registrationEnabled: false,
        registrationCapacity: 50,
        registrationOpensAt: "2031-02-01T09:00",
        registrationClosesAt: "2031-03-01T17:00",
      })
    ).toMatchObject({
      registrationCapacity: undefined,
      registrationOpensAt: undefined,
      registrationClosesAt: undefined,
    });
  });
});
