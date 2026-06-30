/**
 * Readiness: a deeper health check than liveness. Liveness (`/health`) answers
 * "is the process up". Readiness (`/health/ready`) answers "can it actually
 * serve" — database reachable, Redis reachable, and the worker reporting fresh
 * heartbeats. It carries only ok/degraded/down statuses and latencies, never
 * secrets, so it is safe for an unauthenticated load-balancer probe.
 */
import type { FastifyInstance } from "fastify";
import type { TradingMode } from "@agent/core";
import type { WorkerHeartbeat } from "@agent/persistence";
import { ReadinessResponseSchema, type ReadinessResponse } from "../contracts.js";

type ComponentStatus = "ok" | "degraded" | "down";

/** Narrow seams so readiness depends only on what it actually calls. */
export interface ReadinessDeps {
  repo: {
    ping(): Promise<boolean>;
    getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null>;
  };
  opsState: { ping(): Promise<boolean> };
  tradingMode: TradingMode;
  workerId: string;
  heartbeatMaxAgeMs: number;
  now?: () => Date;
}

/** Time a probe and map success/failure to a component health record. */
async function timed(probe: () => Promise<boolean>): Promise<{ status: ComponentStatus; latencyMs: number }> {
  const start = Date.now();
  let ok = false;
  try {
    ok = await probe();
  } catch {
    ok = false;
  }
  return { status: ok ? "ok" : "down", latencyMs: Date.now() - start };
}

function worse(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  const rank: Record<ComponentStatus, number> = { ok: 0, degraded: 1, down: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export async function checkReadiness(deps: ReadinessDeps): Promise<ReadinessResponse> {
  const now = (deps.now ?? (() => new Date()))();

  const [database, redis] = await Promise.all([timed(() => deps.repo.ping()), timed(() => deps.opsState.ping())]);

  // Coinbase is not exercised in paper mode; a real bounded check lands with the
  // execution work (T6.6). Report ok so paper readiness is not falsely down.
  const coinbase = { status: "ok" as ComponentStatus };

  // Worker freshness from the durable heartbeat: missing -> down, stale -> degraded.
  const heartbeat = await deps.repo.getWorkerHeartbeat(deps.workerId);
  let worker: { status: ComponentStatus; latencyMs?: number };
  if (!heartbeat) {
    worker = { status: "down" };
  } else {
    const ageMs = now.getTime() - heartbeat.lastSeenAt.getTime();
    worker = { status: ageMs > deps.heartbeatMaxAgeMs ? "degraded" : "ok", latencyMs: ageMs };
  }

  const overall = [database.status, redis.status, coinbase.status, worker.status].reduce(worse, "ok");

  return ReadinessResponseSchema.parse({
    status: overall,
    components: { database, redis, coinbase, worker },
    checkedAt: now.toISOString()
  });
}

/** Register `/health/ready`. Unauthenticated and secret-free, like `/health`. */
export function registerReadiness(app: FastifyInstance, deps: ReadinessDeps): void {
  app.get("/health/ready", async (_request, reply) => {
    const readiness = await checkReadiness(deps);
    if (readiness.status === "down") reply.code(503);
    return readiness;
  });
}
