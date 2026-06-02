export class InMemoryOpsState {
    killSwitch = false;
    paused = false;
    async getKillSwitchEnabled() { return this.killSwitch; }
    async setKillSwitchEnabled(enabled) { this.killSwitch = enabled; }
    async getPaused() { return this.paused; }
    async setPaused(paused) { this.paused = paused; }
    async close() { }
}
export class RedisOpsState {
    client;
    static KILL_KEY = "ops:kill_switch";
    static PAUSE_KEY = "ops:paused";
    constructor(client) {
        this.client = client;
    }
    async getKillSwitchEnabled() {
        const val = await this.client.get(RedisOpsState.KILL_KEY);
        return val === "1";
    }
    async setKillSwitchEnabled(enabled) {
        await this.client.set(RedisOpsState.KILL_KEY, enabled ? "1" : "0");
    }
    async getPaused() {
        const val = await this.client.get(RedisOpsState.PAUSE_KEY);
        return val === "1";
    }
    async setPaused(paused) {
        await this.client.set(RedisOpsState.PAUSE_KEY, paused ? "1" : "0");
    }
    async close() {
        await this.client.quit();
    }
}
export async function createOpsState(redisUrl) {
    if (!redisUrl) {
        return new InMemoryOpsState();
    }
    const { createClient } = await import("redis");
    const client = createClient({ url: redisUrl });
    client.on("error", (err) => console.error("Redis ops-state error:", err));
    await client.connect();
    return new RedisOpsState(client);
}
