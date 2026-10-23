import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAttachmentStorage,
  isAttachmentStorageConfigured,
} from "#/features/event-requests/attachments.server";

const { storageEnv } = vi.hoisted(() => ({
  storageEnv: {} as Record<string, string | undefined>,
}));

vi.mock("#/env", () => ({ env: storageEnv }));

const CONFIGURED = {
  STORAGE_BUCKET: "connectsphere-attachments-staging",
  STORAGE_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  STORAGE_ACCESS_KEY_ID: "access",
  STORAGE_SECRET_ACCESS_KEY: "secret",
};

beforeEach(() => {
  for (const key of Object.keys(storageEnv)) delete storageEnv[key];
});

describe("attachment storage configuration", () => {
  it("stays off until every value is set, so a partial set never reaches the bucket", () => {
    expect(isAttachmentStorageConfigured()).toBe(false);
    expect(getAttachmentStorage()).toBeNull();

    storageEnv.STORAGE_BUCKET = CONFIGURED.STORAGE_BUCKET;
    expect(isAttachmentStorageConfigured()).toBe(false);
    storageEnv.STORAGE_ENDPOINT = CONFIGURED.STORAGE_ENDPOINT;
    expect(isAttachmentStorageConfigured()).toBe(false);
    storageEnv.STORAGE_ACCESS_KEY_ID = CONFIGURED.STORAGE_ACCESS_KEY_ID;
    expect(isAttachmentStorageConfigured()).toBe(false);
    expect(getAttachmentStorage()).toBeNull();

    storageEnv.STORAGE_SECRET_ACCESS_KEY = CONFIGURED.STORAGE_SECRET_ACCESS_KEY;
    expect(isAttachmentStorageConfigured()).toBe(true);
    expect(getAttachmentStorage()).not.toBeNull();
  });
});
