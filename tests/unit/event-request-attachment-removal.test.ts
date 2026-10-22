import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { ATTACHMENT_NOT_DRAFT_MESSAGE } from "#/features/event-requests/attachments";
import {
  handleRemoveEventRequestAttachment,
  removeAttachmentObjects,
} from "#/features/event-requests/attachments.server";
import { handleDeleteEventRequestDraft } from "#/features/event-requests/drafts.server";
import { EVENT_REQUEST_DELETE_REFUSAL } from "#/features/event-requests/schema";

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock("#/lib/logger", () => ({
  logger: { getChild: () => ({ warn: mockWarn }) },
}));

const organiser: SessionUser = {
  id: "organiser-1",
  email: "organiser@example.com",
  role: "event_organiser",
};

function workingStorage(calls: string[] = []) {
  return {
    put: async () => {},
    get: async () => null,
    remove: async (key: string) => {
      calls.push(`remove:${key}`);
    },
  };
}

function failingStorage() {
  return {
    put: async () => {},
    get: async () => null,
    remove: async () => {
      throw new Error("bucket down");
    },
  };
}

/**
 * The remove handler: lock the owned event row, then read and delete the attachment row.
 * The two selects are told apart by their call order, which matches the handler.
 */
function stubRemoveDatabase(own: { status: string } | null, objectKey: string | null) {
  let selects = 0;
  const eventWhere = vi.fn<() => Promise<{ status: string }[]>>(async () => (own ? [own] : []));
  const attachmentWhere = vi.fn<() => Promise<{ objectKey: string }[]>>(async () =>
    objectKey ? [{ objectKey }] : []
  );
  const deleteWhere = vi.fn<() => Promise<void>>(async () => {});
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          selects += 1;
          return selects === 1 ? { for: eventWhere } : attachmentWhere();
        },
      }),
    }),
    delete: () => ({ where: deleteWhere }),
  };
  const transaction = vi.fn<(run: (value: typeof tx) => Promise<unknown>) => Promise<unknown>>(
    async run => run(tx)
  );
  return {
    database: { transaction },
    eventWhere,
    attachmentWhere,
    deleteWhere,
  };
}

/**
 * The draft delete: lock the owned event row, read the keys, then delete with the returning row.
 * The two selects are told apart by their call order, which matches the handler.
 */
function stubDraftDatabase(
  own: { id: number } | null,
  keys: string[],
  deleted: unknown[],
  calls: string[] = []
) {
  let selects = 0;
  const eventWhere = vi.fn<() => Promise<{ id: number }[]>>(async () => (own ? [own] : []));
  const keyWhere = vi.fn<() => Promise<{ objectKey: string }[]>>(async () =>
    keys.map(objectKey => ({ objectKey }))
  );
  const returning = vi.fn<() => Promise<unknown[]>>(async () => deleted);
  const deleteWhere = vi.fn<() => { returning: () => Promise<unknown[]> }>(() => {
    calls.push("delete");
    return { returning };
  });
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          selects += 1;
          return selects === 1 ? { for: eventWhere } : keyWhere();
        },
      }),
    }),
    delete: () => ({ where: deleteWhere }),
  };
  const transaction = vi.fn<(run: (value: typeof tx) => Promise<unknown>) => Promise<unknown>>(
    async run => run(tx)
  );
  return {
    database: { transaction },
    eventWhere,
    keyWhere,
    deleteWhere,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeAttachmentObjects", () => {
  it("removes every key and does nothing for an empty list", async () => {
    const calls: string[] = [];
    await removeAttachmentObjects(workingStorage(calls), ["a", "b"]);

    expect(calls).toEqual(["remove:a", "remove:b"]);
    expect(mockWarn).not.toHaveBeenCalled();

    await expect(removeAttachmentObjects(null, [])).resolves.toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("logs the skipped cleanup when storage is not configured", async () => {
    await expect(removeAttachmentObjects(null, ["a"])).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledExactlyOnceWith(
      "Attachment object cleanup skipped: storage is not configured",
      { count: 1 }
    );
  });

  it("logs a failed object delete and still resolves", async () => {
    await expect(removeAttachmentObjects(failingStorage(), ["a", "b"])).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn.mock.calls[0][0]).toBe("Attachment object cleanup failed");
    expect(mockWarn.mock.calls[0][1]).toMatchObject({ key: "a" });
    expect(mockWarn.mock.calls[1][1]).toMatchObject({ key: "b" });
  });
});

describe("handleRemoveEventRequestAttachment", () => {
  it("deletes the owned draft's row and its object", async () => {
    const { database, deleteWhere } = stubRemoveDatabase(
      { status: "draft" },
      "event-requests/41/key.pdf"
    );
    const calls: string[] = [];

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        workingStorage(calls)
      )
    ).resolves.toBeUndefined();

    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(calls).toEqual(["remove:event-requests/41/key.pdf"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("reads another organiser's attachment as gone without reading its key", async () => {
    const { database, attachmentWhere, deleteWhere } = stubRemoveDatabase(null, "key.pdf");
    const calls: string[] = [];

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        workingStorage(calls)
      )
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(attachmentWhere).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("refuses a submitted request's attachment and removes nothing", async () => {
    const { database, deleteWhere } = stubRemoveDatabase({ status: "submitted" }, "key.pdf");
    const calls: string[] = [];

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        workingStorage(calls)
      )
    ).rejects.toMatchObject({ name: "ConflictError", message: ATTACHMENT_NOT_DRAFT_MESSAGE });

    expect(deleteWhere).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("reads a missing attachment row as gone", async () => {
    const { database, deleteWhere } = stubRemoveDatabase({ status: "draft" }, null);

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        workingStorage()
      )
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("logs a failed object delete and still answers", async () => {
    const { database } = stubRemoveDatabase({ status: "draft" }, "event-requests/41/key.pdf");

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        failingStorage()
      )
    ).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledOnce();
    expect(mockWarn.mock.calls[0][0]).toBe("Attachment object cleanup failed");
    expect(mockWarn.mock.calls[0][1]).toMatchObject({ key: "event-requests/41/key.pdf" });
  });
});

describe("handleDeleteEventRequestDraft attachment cleanup", () => {
  it("deletes the draft's objects after the deletion commits", async () => {
    const calls: string[] = [];
    const { database } = stubDraftDatabase({ id: 41 }, ["a", "b"], [{ id: 41 }], calls);

    const deleted = await handleDeleteEventRequestDraft(
      { id: 41 },
      organiser,
      database as never,
      workingStorage(calls)
    );

    expect(deleted).toEqual({ id: 41 });
    expect(calls[0]).toBe("delete");
    expect(calls.slice(1).toSorted()).toEqual(["remove:a", "remove:b"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("still deletes the draft when an object delete fails", async () => {
    const { database } = stubDraftDatabase({ id: 41 }, ["a"], [{ id: 41 }]);

    const deleted = await handleDeleteEventRequestDraft(
      { id: 41 },
      organiser,
      database as never,
      failingStorage()
    );

    expect(deleted).toEqual({ id: 41 });
    expect(mockWarn).toHaveBeenCalledOnce();
    expect(mockWarn.mock.calls[0][1]).toMatchObject({ key: "a" });
  });

  it("refuses another organiser's request without reading its keys", async () => {
    const calls: string[] = [];
    const { database, keyWhere } = stubDraftDatabase(null, ["a"], [{ id: 41 }], calls);

    await expect(
      handleDeleteEventRequestDraft({ id: 41 }, organiser, database as never, workingStorage(calls))
    ).rejects.toMatchObject({ name: "AuthorizationError" });

    expect(keyWhere).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("removes no objects when the delete is refused", async () => {
    // The lock finds the owned row, but the scoped delete matches no draft: a submitted request.
    const calls: string[] = [];
    const { database } = stubDraftDatabase({ id: 41 }, ["a"], [], calls);

    await expect(
      handleDeleteEventRequestDraft({ id: 41 }, organiser, database as never, workingStorage(calls))
    ).rejects.toMatchObject({ name: "ConflictError", message: EVENT_REQUEST_DELETE_REFUSAL });

    expect(calls).toEqual(["delete"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
