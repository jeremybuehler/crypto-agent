/**
 * T5.2: kill-switch activation pages immediately. The API dispatches a critical
 * alert the moment the operator engages the kill switch; routine ops actions
 * (pause) stay quiet. Uses an injected capturing sink — no webhook, no stdout.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig, type Alert, type AlertSink } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";
import { PostgresOperatorRepository } from "@agent/persistence";
import { buildServer } from "../../apps/api/src/server.js";
import { createMigratedPglite, type PgliteExecutor } from "../support/pglite-executor.js";

const OPERATOR_TOKEN = "operator-".padEnd(40, "x");
const opAuth = { authorization: `Bearer ${OPERATOR_TOKEN}` };

function testConfig(): AgentConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TRADING_MODE: "paper",
    PERSISTENCE_ENABLED: "false",
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    INTERNAL_API_TOKEN: "internal-".padEnd(40, "y"),
    ALLOWED_ORIGINS: "https://dash.example"
  });
}

class CapturingAlertSink implements AlertSink {
  readonly alerts: Alert[] = [];
  async deliver(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

let db: PgliteExecutor;
let captured: CapturingAlertSink;

async function buildApp() {
  captured = new CapturingAlertSink();
  const app = await buildServer(testConfig(), {
    opsState: new InMemoryOpsState(),
    operatorRepo: new PostgresOperatorRepository(db),
    alertSinks: [captured]
  });
  await app.ready();
  return app;
}

beforeAll(async () => {
  db = await createMigratedPglite();
});

beforeEach(async () => {
  await db.query("TRUNCATE audit_events");
});

afterAll(async () => {
  await db.close();
});

describe("kill-switch alerting", () => {
  it("engaging the kill switch dispatches a critical alert immediately", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/ops/kill-switch", headers: opAuth });
      expect(res.statusCode).toBe(200);

      expect(captured.alerts).toHaveLength(1);
      const alert = captured.alerts[0]!;
      expect(alert.kind).toBe("kill_switch");
      expect(alert.severity).toBe("critical");
    } finally {
      await app.close();
    }
  });

  it("pause does not page", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/ops/pause", headers: opAuth });
      expect(res.statusCode).toBe(200);
      expect(captured.alerts).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
