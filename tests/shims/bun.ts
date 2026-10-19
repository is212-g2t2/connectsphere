export class SQL {
  constructor(public connectionString?: string) {}
}

export class RedisClient {
  constructor(public url?: string) {}

  async get(_key: string): Promise<string | null> {
    return null;
  }

  async set(_key: string, _value: string): Promise<void> {}

  async del(_key: string): Promise<number> {
    return 1;
  }

  async incr(_key: string): Promise<number> {
    return 1;
  }

  async expire(_key: string, _seconds: number): Promise<boolean> {
    return true;
  }
}

/**
 * Stand-in for Bun's built-in S3 client, which Node-based Vitest cannot load. Import-safe;
 * every method fails loudly so a test that reaches the real bucket fails instead of passing.
 */
export class S3Client {
  constructor(public options?: unknown) {}

  async write(): Promise<number> {
    throw new Error("S3Client is not available in tests");
  }

  file(): {
    exists(): Promise<boolean>;
    arrayBuffer(): Promise<ArrayBuffer>;
    delete(): Promise<void>;
  } {
    throw new Error("S3Client is not available in tests");
  }
}
