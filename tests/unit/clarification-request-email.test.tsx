import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";

describe("ClarificationRequestEmail (PTR-19 criterion 3)", () => {
  it("renders the event name, clarification body, and action button", async () => {
    const eventName = "Tech Innovation Summit";
    const body = "Please clarify how many projectors and microphones you will need.";
    const eventRequestUrl = "http://localhost:3000/event-requests/42";

    const html = await render(
      <ClarificationRequestEmail
        eventName={eventName}
        body={body}
        eventRequestUrl={eventRequestUrl}
      />
    );

    expect(html).toContain("Clarification requested");
    expect(html).toContain(eventName);
    expect(html).toContain(body);
    expect(html).toContain(eventRequestUrl);
    expect(html).toContain("View your request");
    expect(html).toContain("Sent from ConnectSphere.");
  });
});
