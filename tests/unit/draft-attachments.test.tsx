// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraftAttachments } from "#/features/event-requests/components/draft-attachments";
import { ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";

const {
  listEventRequestAttachments,
  uploadEventRequestAttachment,
  downloadEventRequestAttachment,
} = vi.hoisted(() => ({
  listEventRequestAttachments: vi.fn<(options: { data: { id: number } }) => Promise<unknown>>(),
  uploadEventRequestAttachment: vi.fn<(options: { data: FormData }) => Promise<unknown>>(),
  downloadEventRequestAttachment:
    vi.fn<(options: { data: { id: number; attachmentId: number } }) => Promise<unknown>>(),
}));

vi.mock("#/features/event-requests/server-fns", () => ({
  listEventRequestAttachments,
  uploadEventRequestAttachment,
  downloadEventRequestAttachment,
}));

const listed = {
  attachments: [
    {
      id: 7,
      originalFilename: "plan.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
  ],
  storageAvailable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  listEventRequestAttachments.mockResolvedValue(listed);
});

describe("DraftAttachments", () => {
  it("lists the draft's attachments with a download for each", async () => {
    render(<DraftAttachments draftId={41} />);

    expect(await screen.findByText("plan.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(screen.getByText("1 of 10 attachments used.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Download" })).toBeTruthy();
    expect(listEventRequestAttachments).toHaveBeenCalledExactlyOnceWith({ data: { id: 41 } });
  });

  it("uploads the chosen file with the draft id and refreshes the list", async () => {
    const user = userEvent.setup();
    uploadEventRequestAttachment.mockResolvedValue({ id: 8 });
    render(<DraftAttachments draftId={41} />);

    await user.upload(
      await screen.findByLabelText("Choose a file to attach"),
      new File(["%PDF-1.4"], "plan.pdf", { type: "application/pdf" })
    );
    await user.click(screen.getByRole("button", { name: "Attach file" }));

    await waitFor(() => expect(uploadEventRequestAttachment).toHaveBeenCalledOnce());
    const sent = uploadEventRequestAttachment.mock.calls[0][0].data;
    expect(sent.get("id")).toBe("41");
    expect((sent.get("file") as File).name).toBe("plan.pdf");
    await waitFor(() => expect(listEventRequestAttachments).toHaveBeenCalledTimes(2));
  });

  it("shows the server's reason when the upload is refused", async () => {
    const user = userEvent.setup();
    uploadEventRequestAttachment.mockRejectedValue(
      new Error("This file type is not supported. Attach a PDF, PNG, JPEG, or DOCX file.")
    );
    render(<DraftAttachments draftId={41} />);

    // Named .pdf so the file input accepts it; the bytes are not a PDF, so the server refuses
    // it from its content, never the client header.
    await user.upload(
      await screen.findByLabelText("Choose a file to attach"),
      new File(["not a pdf"], "plan.pdf", { type: "application/pdf" })
    );
    await user.click(screen.getByRole("button", { name: "Attach file" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This file type is not supported. Attach a PDF, PNG, JPEG, or DOCX file."
    );
  });

  it("reports attaching as unavailable without storage, and lists nothing else missing", async () => {
    listEventRequestAttachments.mockResolvedValue({ attachments: [], storageAvailable: false });
    render(<DraftAttachments draftId={41} />);

    expect(await screen.findByText(ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByLabelText("Choose a file to attach")).toBeNull();
    expect(await screen.findByText("No supporting documents yet.")).toBeTruthy();
  });

  it("downloads the file the server returns", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn<() => string>(() => "blob:mock");
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = vi.fn<() => void>();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadEventRequestAttachment.mockResolvedValue({
      filename: "plan.pdf",
      contentType: "application/pdf",
      base64: btoa("%PDF-1.4"),
    });
    render(<DraftAttachments draftId={41} />);

    await user.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() => expect(downloadEventRequestAttachment).toHaveBeenCalledOnce());
    expect(downloadEventRequestAttachment).toHaveBeenCalledWith({
      data: { id: 41, attachmentId: 7 },
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
