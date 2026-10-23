import { createHash, createHmac } from "node:crypto";
import { SQL, RedisClient } from "./bun";

export { SQL, RedisClient };

/**
 * Node-based stand-in for Bun's built-in S3 client. Node-based Vitest cannot load the
 * `bun` module, so the integration project aliases `bun` here instead of the throwing
 * unit shim. Every operation signs a real SigV4 request and talks to the real bucket
 * in the testcontainer. `S3AttachmentStorage` keeps the same surface, so this stays a
 * drop-in for `getAttachmentStorage()`.
 */
export class S3Client {
  private readonly base: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(options?: {
    bucket?: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    if (!options?.bucket || !options.endpoint || !options.accessKeyId || !options.secretAccessKey) {
      throw new Error("S3Client needs a bucket, an endpoint, and credentials.");
    }
    this.bucket = options.bucket;
    this.base = `${options.endpoint.replace(/\/+$/, "")}/${options.bucket}`;
    this.region = options.region || "auto";
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
  }

  async write(key: string, bytes: Uint8Array, options?: { type?: string }): Promise<number> {
    const response = await this.request("PUT", key, bytes, options?.type);
    if (!response.ok) throw new Error(`S3 PUT ${key} failed with ${response.status}.`);
    return bytes.length;
  }

  file(key: string): {
    exists(): Promise<boolean>;
    arrayBuffer(): Promise<ArrayBuffer>;
    delete(): Promise<void>;
  } {
    return {
      exists: async (): Promise<boolean> => {
        const response = await this.request("HEAD", key);
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(`S3 HEAD ${key} failed with ${response.status}.`);
        await response.arrayBuffer().catch(() => undefined);
        return true;
      },
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        const response = await this.request("GET", key);
        if (!response.ok) throw new Error(`S3 GET ${key} failed with ${response.status}.`);
        return response.arrayBuffer();
      },
      delete: async (): Promise<void> => {
        const response = await this.request("DELETE", key);
        if (!response.ok) throw new Error(`S3 DELETE ${key} failed with ${response.status}.`);
      },
    };
  }

  private async request(
    method: string,
    key: string,
    body?: Uint8Array,
    contentType?: string
  ): Promise<Response> {
    const url = `${this.base}/${encodeKey(key)}`;
    const payloadHash = sha256Hex(body ?? new Uint8Array(0));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(url).host;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const canonicalRequest = [
      method,
      `/${this.bucket}/${encodeKey(key)}`,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const signature = sign(
      this.secretAccessKey,
      dateStamp,
      this.region,
      `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
    );
    return fetch(url, {
      method,
      headers: {
        authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(contentType ? { "content-type": contentType } : {}),
      },
      body: body ? (body as BodyInit) : undefined,
    });
  }
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map(segment =>
      encodeURIComponent(segment).replace(
        /[!*'()]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function sign(secret: string, dateStamp: string, region: string, stringToSign: string): string {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(region).digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  const signingKey = createHmac("sha256", serviceKey).update("aws4_request").digest();
  return createHmac("sha256", signingKey).update(stringToSign).digest("hex");
}
