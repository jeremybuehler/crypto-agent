export interface OpsState {
  getKillSwitchEnabled(): Promise<boolean>;
  setKillSwitchEnabled(enabled: boolean): Promise<void>;
  getPaused(): Promise<boolean>;
  setPaused(paused: boolean): Promise<void>;
  /** Cheap connectivity probe for readiness checks. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class InMemoryOpsState implements OpsState {
  private killSwitch = false;
  private paused = false;

  async getKillSwitchEnabled() { return this.killSwitch; }
  async setKillSwitchEnabled(enabled: boolean) { this.killSwitch = enabled; }
  async getPaused() { return this.paused; }
  async setPaused(paused: boolean) { this.paused = paused; }
  async ping() { return true; }
  async close() {}
}

type RedisClientLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  quit(): Promise<unknown>;
};

export class RedisOpsState implements OpsState {
  private static readonly KILL_KEY = "ops:kill_switch";
  private static readonly PAUSE_KEY = "ops:paused";

  constructor(private readonly client: RedisClientLike) {}

  async getKillSwitchEnabled(): Promise<boolean> {
    const val = await this.client.get(RedisOpsState.KILL_KEY);
    return val === "1";
  }

  async setKillSwitchEnabled(enabled: boolean): Promise<void> {
    await this.client.set(RedisOpsState.KILL_KEY, enabled ? "1" : "0");
  }

  async getPaused(): Promise<boolean> {
    const val = await this.client.get(RedisOpsState.PAUSE_KEY);
    return val === "1";
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.client.set(RedisOpsState.PAUSE_KEY, paused ? "1" : "0");
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.get(RedisOpsState.PAUSE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export async function createOpsState(redisUrl?: string): Promise<OpsState> {
  if (!redisUrl) {
    return new InMemoryOpsState();
  }
  const { createClient } = await import("redis");
  const client = createClient({ url: redisUrl });
  client.on("error", (err) => console.error("Redis ops-state error:", err));
  await client.connect();
  return new RedisOpsState(client);
}
