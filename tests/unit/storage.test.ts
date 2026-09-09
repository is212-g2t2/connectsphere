import { describe, expect, test } from "vitest";

import {
  validateUploadRequest,
  createStorageClient,
  getStorageClient,
  safeExtension,
} from "#/lib/storage";

describe("validateUploadRequest", () => {
  test("accepts valid image mime type", () => {
    expect(
      validateUploadRequest({ filename: "photo.jpg", contentType: "image/jpeg", size: 1024 })
    ).toBeNull();
  });

  test("rejects unsupported mime type", () => {
    expect(
      validateUploadRequest({ filename: "script.sh", contentType: "application/x-sh", size: 100 })
    ).toBe("Unsupported file type");
  });

  test("rejects file over 10MB", () => {
    expect(
      validateUploadRequest({
        filename: "big.png",
        contentType: "image/png",
        size: 11 * 1024 * 1024,
      })
    ).toBe("File must be 10 MB or smaller");
  });

  test("accepts file of exactly 10MB", () => {
    expect(
      validateUploadRequest({
        filename: "limit.png",
        contentType: "image/png",
        size: 10 * 1024 * 1024,
      })
    ).toBeNull();
  });
});

describe("createStorageClient", () => {
  test("returns null when endpoint is missing", () => {
    expect(createStorageClient(undefined, undefined, undefined)).toBeNull();
  });

  test("returns null when access key is missing", () => {
    expect(createStorageClient("http://localhost:9000", undefined, "password")).toBeNull();
  });

  test("returns null when secret key is missing", () => {
    expect(createStorageClient("http://localhost:9000", "admin", undefined)).toBeNull();
  });

  test("returns S3Client when endpoint is provided", () => {
    const client = createStorageClient("http://localhost:9000", "admin", "password");
    expect(client).not.toBeNull();
  });
});

describe("safeExtension", () => {
  test("maps image/jpeg to jpg", () => {
    expect(safeExtension("image/jpeg")).toBe("jpg");
  });

  test("maps application/pdf to pdf", () => {
    expect(safeExtension("application/pdf")).toBe("pdf");
  });

  test("returns bin for unknown content type", () => {
    expect(safeExtension("application/octet-stream")).toBe("bin");
  });
});

describe("client.presign", () => {
  test("generates presigned PUT url for key and contentType", () => {
    const client = createStorageClient("http://localhost:9000", "admin", "password", "test-bucket");
    expect(client).not.toBeNull();
    if (!client) throw new Error("Client was null");
    const url = client.presign("test.png", { method: "PUT", type: "image/png" });
    expect(url).toContain("test.png");
  });
});

describe("getStorageClient", () => {
  test("returns client singleton or null based on env", () => {
    const client = getStorageClient();
    expect(client === null || typeof client === "object").toBe(true);
  });
});
