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
