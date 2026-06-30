/**
 * Prometheus metrics endpoint (`/metrics/prom`). Samples are derived on demand
 * from durable state — realized PnL/win-loss from fills and worker heartbeat
 * freshness — so the exposition always reflects the database, not an in-process
 * accumulator that resets on restart. Operator-authenticated, since the numbers
 * reveal portfolio performance.
 *
 * The operator JSON metrics live at `/metrics`; the Prometheus text exposition
 * is at `/metrics/prom` to avoid colliding with that established contract.
 */
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { renderPrometheus, type MetricSample } from "@agent/core";
import type { RealizedMetrics, WorkerHeartbeat } from "@agent/persistence";

export function buildMetricSamples(
  metrics: RealizedMetrics & { equityUsd: number | null },
  heartbeat: WorkerHeartbeat | null,
  now: Date
): MetricSample[] {
  const samples: MetricSample[] = [
    { name: "cg_up", help: "1 if the API is serving", type: "gauge", value: 1 },
    { name: "cg_trades_total", help: "Total fills", type: "counter", value: metrics.totalTrades },
    { name: "cg_wins_total", help: "Closing sells with positive realized PnL", type: "counter", value: metrics.wins },
    { name: "cg_losses_total", help: "Closing sells with non-positive realized PnL", type: "counter", value: metrics.losses },
    { name: "cg_fees_usd", help: "Total fees paid in USD", type: "gauge", value: metrics.totalFees },
    { name: "cg_realized_pnl_usd", help: "Realized PnL in USD (net of fees)", type: "gauge", value: metrics.realizedPnl }
  ];
  if (metrics.equityUsd !== null) {
    samples.push({ name: "cg_equity_usd", help: "Account equity in USD", type: "gauge", value: metrics.equityUsd });
  }
  if (heartbeat) {
    const ageSeconds = Math.floor((now.getTime() - heartbeat.lastSeenAt.getTime()) / 1000);
    samples.push({
      name: "cg_worker_heartbeat_age_seconds",
      help: "Seconds since the worker last reported",
      type: "gauge",
      value: ageSeconds
    });
  }
  return samples;
}

export interface PrometheusDeps {
  repo: {
    getMetrics(): Promise<RealizedMetrics & { equityUsd: number | null }>;
    getWorkerHeartbeat(workerId: string): Promise<WorkerHeartbeat | null>;
  };
  workerId: string;
  requireOperator: preHandlerHookHandler;
  now?: () => Date;
}

/** Register `/metrics/prom` behind operator auth. */
export function registerPrometheus(app: FastifyInstance, deps: PrometheusDeps): void {
  app.get("/metrics/prom", { preHandler: deps.requireOperator }, async (_request, reply) => {
    const [metrics, heartbeat] = await Promise.all([
      deps.repo.getMetrics(),
      deps.repo.getWorkerHeartbeat(deps.workerId)
    ]);
    const now = (deps.now ?? (() => new Date()))();
    reply.header("content-type", "text/plain; version=0.0.4");
    return renderPrometheus(buildMetricSamples(metrics, heartbeat, now));
  });
}
