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

function workingStorage() {
  const removed: string[] = [];
  return {
    removed,
    put: async () => {},
    get: async () => null,
    remove: async (key: string) => {
      removed.push(key);
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

/** The ownership read in the remove handler: one joined row, or none for another organiser. */
function stubRemoveDatabase(owned: { objectKey: string; status: string } | null) {
  const selectWhere = vi.fn<() => Promise<{ objectKey: string; status: string }[]>>(async () =>
    owned ? [owned] : []
  );
  const deleteWhere = vi.fn<() => Promise<{ id: number }[]>>(async () => [{ id: 7 }]);
  return {
    database: {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: selectWhere }) }) }),
      delete: () => ({ where: deleteWhere }),
    },
    selectWhere,
    deleteWhere,
  };
}

/** The key read and the scoped delete in the draft delete handler. */
function stubDraftDatabase(keys: string[], deleted: unknown[]) {
  const selectWhere = vi.fn<() => Promise<{ objectKey: string }[]>>(async () =>
    keys.map(objectKey => ({ objectKey }))
  );
  const returning = vi.fn<() => Promise<unknown[]>>(async () => deleted);
  const deleteWhere = vi.fn<() => { returning: () => Promise<unknown[]> }>(() => ({ returning }));
  return {
    database: {
      select: () => ({ from: () => ({ where: selectWhere }) }),
      delete: () => ({ where: deleteWhere }),
    },
    selectWhere,
    deleteWhere,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeAttachmentObjects", () => {
  it("removes every key and stays quiet with no storage", async () => {
    const storage = workingStorage();

    await removeAttachmentObjects(storage, ["a", "b"]);

    expect(storage.removed).toEqual(["a", "b"]);
    expect(mockWarn).not.toHaveBeenCalled();
    await expect(removeAttachmentObjects(null, ["a"])).resolves.toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
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
    const { database, deleteWhere } = stubRemoveDatabase({
      objectKey: "event-requests/41/key.pdf",
      status: "draft",
    });
    const storage = workingStorage();

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        storage
      )
    ).resolves.toEqual({ id: 7 });

    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(storage.removed).toEqual(["event-requests/41/key.pdf"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("reads another organiser's attachment as gone and removes nothing", async () => {
    const { database, deleteWhere } = stubRemoveDatabase(null);
    const storage = workingStorage();

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(deleteWhere).not.toHaveBeenCalled();
    expect(storage.removed).toEqual([]);
  });

  it("refuses a submitted request's attachment and removes nothing", async () => {
    const { database, deleteWhere } = stubRemoveDatabase({
      objectKey: "event-requests/41/key.pdf",
      status: "submitted",
    });
    const storage = workingStorage();

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        storage
      )
    ).rejects.toMatchObject({ name: "ConflictError", message: ATTACHMENT_NOT_DRAFT_MESSAGE });

    expect(deleteWhere).not.toHaveBeenCalled();
    expect(storage.removed).toEqual([]);
  });

  it("logs a failed object delete and still answers", async () => {
    const { database } = stubRemoveDatabase({
      objectKey: "event-requests/41/key.pdf",
      status: "draft",
    });

    await expect(
      handleRemoveEventRequestAttachment(
        { id: 41, attachmentId: 7 },
        organiser,
        database as never,
        failingStorage()
      )
    ).resolves.toEqual({ id: 7 });

    expect(mockWarn).toHaveBeenCalledOnce();
    expect(mockWarn.mock.calls[0][0]).toBe("Attachment object cleanup failed");
    expect(mockWarn.mock.calls[0][1]).toMatchObject({ key: "event-requests/41/key.pdf" });
  });
});

describe("handleDeleteEventRequestDraft attachment cleanup", () => {
  it("deletes the draft's objects after the deletion commits", async () => {
    const { database } = stubDraftDatabase(["a", "b"], [{ id: 41 }]);
    const storage = workingStorage();

    const deleted = await handleDeleteEventRequestDraft(
      { id: 41 },
      organiser,
      database as never,
      storage
    );

    expect(deleted).toEqual({ id: 41 });
    expect(storage.removed).toEqual(["a", "b"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("still deletes the draft when an object delete fails", async () => {
    const { database } = stubDraftDatabase(["a"], [{ id: 41 }]);

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

  it("removes no objects when the delete is refused", async () => {
    // The key read answers rows, but the scoped delete matches nothing while the row exists:
    // a submitted request, refused as a conflict.
    const selectWhere = vi.fn<() => Promise<unknown[]>>(async () => [
      { objectKey: "a" },
      { id: 41 },
    ]);
    const database = {
      select: () => ({ from: () => ({ where: selectWhere }) }),
      delete: () => ({ where: () => ({ returning: async () => [] }) }),
    };
    const storage = workingStorage();

    await expect(
      handleDeleteEventRequestDraft({ id: 41 }, organiser, database as never, storage)
    ).rejects.toMatchObject({ name: "ConflictError", message: EVENT_REQUEST_DELETE_REFUSAL });

    expect(storage.removed).toEqual([]);
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
