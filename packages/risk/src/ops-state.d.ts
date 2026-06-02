import type { createClient } from "redis";
export interface OpsState {
    getKillSwitchEnabled(): Promise<boolean>;
    setKillSwitchEnabled(enabled: boolean): Promise<void>;
    getPaused(): Promise<boolean>;
    setPaused(paused: boolean): Promise<void>;
    close(): Promise<void>;
}
export declare class InMemoryOpsState implements OpsState {
    private killSwitch;
    private paused;
    getKillSwitchEnabled(): Promise<boolean>;
    setKillSwitchEnabled(enabled: boolean): Promise<void>;
    getPaused(): Promise<boolean>;
    setPaused(paused: boolean): Promise<void>;
    close(): Promise<void>;
}
export declare class RedisOpsState implements OpsState {
    private readonly client;
    private static readonly KILL_KEY;
    private static readonly PAUSE_KEY;
    constructor(client: ReturnType<typeof createClient>);
    getKillSwitchEnabled(): Promise<boolean>;
    setKillSwitchEnabled(enabled: boolean): Promise<void>;
    getPaused(): Promise<boolean>;
    setPaused(paused: boolean): Promise<void>;
    close(): Promise<void>;
}
export declare function createOpsState(redisUrl?: string): Promise<OpsState>;
