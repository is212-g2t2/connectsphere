// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiftVenueBlockButton,
  RecordVenueBlockDialog,
} from "#/features/venues/components/venue-block-actions";
import { toast } from "sonner";

const { mockInvalidate, mockNavigate, mockRecordBlock, mockLiftBlock } = vi.hoisted(() => ({
  mockInvalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockNavigate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockRecordBlock: vi.fn<() => Promise<{ id: number }>>().mockResolvedValue({ id: 9 }),
  mockLiftBlock: vi.fn<() => Promise<{ id: number }>>().mockResolvedValue({ id: 9 }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => ({
    invalidate: mockInvalidate,
    navigate: mockNavigate,
  }),
}));

vi.mock("#/features/venues/server-fns", () => ({
  recordVenueBlock: mockRecordBlock,
  liftVenueBlock: mockLiftBlock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(msg?: unknown) => void>(),
    error: vi.fn<(msg?: unknown) => void>(),
  },
}));

describe("venue block action components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordBlock.mockResolvedValue({ id: 9 });
    mockLiftBlock.mockResolvedValue({ id: 9 });
  });

  describe("RecordVenueBlockDialog", () => {
    it("submits the payload with blank end fields as undefined", async () => {
      const user = userEvent.setup();
      render(
        <RecordVenueBlockDialog venueId={7} venueName="Great Hall" defaultDate="2026-10-05" />
      );

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      expect(await screen.findByRole("heading", { name: "Block venue" })).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Reason for block"), {
        target: { value: "Maintenance" },
      });
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(mockRecordBlock).toHaveBeenCalledWith({
          data: {
            venueId: 7,
            date: "2026-10-05",
            startTime: "09:00",
            endDate: undefined,
            endTime: undefined,
            reason: "Maintenance",
          },
        });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("refuses a blank reason without calling the server", async () => {
      const user = userEvent.setup();
      render(
        <RecordVenueBlockDialog venueId={7} venueName="Great Hall" defaultDate="2026-10-05" />
      );

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(screen.getByText("Enter a reason for this block")).toBeTruthy();
        expect(mockRecordBlock).not.toHaveBeenCalled();
      });
    });

    it("refuses an end date without an end time", async () => {
      const user = userEvent.setup();
      render(
        <RecordVenueBlockDialog venueId={7} venueName="Great Hall" defaultDate="2026-10-05" />
      );

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      fireEvent.change(screen.getByLabelText("End date (optional)"), {
        target: { value: "2026-10-06" },
      });
      fireEvent.change(screen.getByLabelText("Reason for block"), {
        target: { value: "Maintenance" },
      });
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(screen.getByText("Enter both an end date and end time")).toBeTruthy();
        expect(mockRecordBlock).not.toHaveBeenCalled();
      });
    });

    it("shows a server refusal beside the form", async () => {
      mockRecordBlock.mockRejectedValueOnce(
        new Error("Great Hall is unavailable 5 Oct 2026, 09:00 – 12:00")
      );
      const user = userEvent.setup();
      render(
        <RecordVenueBlockDialog venueId={7} venueName="Great Hall" defaultDate="2026-10-05" />
      );

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      fireEvent.change(screen.getByLabelText("Reason for block"), {
        target: { value: "Maintenance" },
      });
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("is unavailable");
      });
    });

    it("leaves the end empty by default and records an open-ended block unedited", async () => {
      const user = userEvent.setup();
      render(
        <RecordVenueBlockDialog venueId={7} venueName="Great Hall" defaultDate="2026-10-05" />
      );

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      expect(await screen.findByRole("heading", { name: "Block venue" })).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>("End date (optional)").value).toBe("");
      expect(screen.getByText(/suspended until you lift the block/)).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Reason for block"), {
        target: { value: "Maintenance" },
      });
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(mockRecordBlock).toHaveBeenCalledWith({
          data: {
            venueId: 7,
            date: "2026-10-05",
            startTime: "09:00",
            endDate: undefined,
            endTime: undefined,
            reason: "Maintenance",
          },
        });
        expect(toast.success).toHaveBeenCalledWith(
          "Block recorded: 5 Oct 2026, 09:00 – until lifted."
        );
      });
    });

    it("accepts a start-only form with no end date or time", async () => {
      const user = userEvent.setup();
      render(<RecordVenueBlockDialog venueId={7} venueName="Great Hall" />);

      await user.click(screen.getByRole("button", { name: "Block venue" }));
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
      fireEvent.change(screen.getByLabelText("Reason for block"), {
        target: { value: "Maintenance" },
      });
      await user.click(screen.getByRole("button", { name: "Record block" }));

      await waitFor(() => {
        expect(mockRecordBlock).toHaveBeenCalledWith({
          data: {
            venueId: 7,
            date: "2026-10-05",
            startTime: "09:00",
            endDate: undefined,
            endTime: undefined,
            reason: "Maintenance",
          },
        });
      });
    });
  });

  describe("LiftVenueBlockButton", () => {
    it("calls liftVenueBlock with the numeric id on confirmation", async () => {
      const user = userEvent.setup();
      render(
        <LiftVenueBlockButton
          blockId="9"
          reason="Maintenance"
          startsAt="2026-10-05T13:00:00"
          endsAt="2026-10-05T15:00:00"
        />
      );

      await user.click(screen.getByRole("button", { name: /Lift venue block/ }));
      await user.click(await screen.findByRole("button", { name: "Confirm lift" }));

      await waitFor(() => {
        expect(mockLiftBlock).toHaveBeenCalledWith({ data: { id: 9 } });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("shows an already-lifted refusal verbatim", async () => {
      mockLiftBlock.mockRejectedValueOnce(new Error("This block has already been lifted."));
      const user = userEvent.setup();
      render(
        <LiftVenueBlockButton
          blockId="9"
          reason="Maintenance"
          startsAt="2026-10-05T13:00:00"
          endsAt="2026-10-05T15:00:00"
        />
      );

      await user.click(screen.getByRole("button", { name: /Lift venue block/ }));
      await user.click(await screen.findByRole("button", { name: "Confirm lift" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("already been lifted");
      });
    });

    it("names an open-ended period as until lifted", async () => {
      const user = userEvent.setup();
      render(
        <LiftVenueBlockButton
          blockId="9"
          reason="Maintenance"
          startsAt="2026-10-05T13:00:00"
          endsAt="2026-10-05T15:00:00"
          openEnded
        />
      );

      await user.click(screen.getByRole("button", { name: /Lift venue block/ }));

      expect(await screen.findByText(/until lifted/)).toBeTruthy();
    });

    it("names the true period in wall-clock text with the conditional outcome", async () => {
      const user = userEvent.setup();
      render(
        <LiftVenueBlockButton
          blockId="9"
          reason="Maintenance"
          startsAt="2026-10-05T09:00:00"
          endsAt="2026-10-05T12:00:00"
        />
      );

      await user.click(screen.getByRole("button", { name: /Lift venue block/ }));

      expect(await screen.findByText(/5 Oct 2026, 09:00 – 12:00/)).toBeTruthy();
      expect(screen.getByText(/unless a new arrangement now overlaps it/)).toBeTruthy();
    });

    it("names the end date of a multi-day block", async () => {
      const user = userEvent.setup();
      render(
        <LiftVenueBlockButton
          blockId="9"
          reason="Maintenance"
          startsAt="2026-10-05T09:00:00"
          endsAt="2026-10-07T12:00:00"
        />
      );

      await user.click(screen.getByRole("button", { name: /Lift venue block/ }));

      expect(await screen.findByText(/5 Oct 2026, 09:00 – 7 Oct 2026, 12:00/)).toBeTruthy();
    });
  });
});
