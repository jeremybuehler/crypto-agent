import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";
import { PostgresOperatorRepository } from "@agent/persistence";
import { buildServer } from "../../apps/api/src/server.js";
import { createMigratedPglite, type PgliteExecutor } from "../support/pglite-executor.js";

const OPERATOR_TOKEN = "operator-".padEnd(40, "x");
const INTERNAL_TOKEN = "internal-".padEnd(40, "y");
const opAuth = { authorization: `Bearer ${OPERATOR_TOKEN}` };
const intAuth = { "x-internal-token": INTERNAL_TOKEN };

function testConfig(): AgentConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TRADING_MODE: "paper",
    PERSISTENCE_ENABLED: "false",
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    ALLOWED_ORIGINS: "https://dash.example"
  });
}

let db: PgliteExecutor;
async function buildApp() {
  const app = await buildServer(testConfig(), { opsState: new InMemoryOpsState(), operatorRepo: new PostgresOperatorRepository(db) });
  await app.ready();
  return app;
}

beforeAll(async () => { db = await createMigratedPglite(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.truncateAll(); });

describe("learning API", () => {
  it("operator sets a fact and reads it back from the profile", async () => {
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/profile", headers: opAuth, payload: { key: "risk_tolerance", value: "conservative" } });
    const profile = (await app.inject({ method: "GET", url: "/profile", headers: opAuth })).json();
    expect(profile.facts.length).toBe(1);
    expect(profile.facts[0].provenance.source).toBe("operator");
    await app.close();
  });

  it("worker observations land as pending insights, not active facts", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/observe",
      headers: intAuth,
      payload: { key: "prefers_btc", value: "true", confidence: 0.6, source: "trend-analyzer" }
    });
    const profile = (await app.inject({ method: "GET", url: "/profile", headers: opAuth })).json();
    expect(profile.facts.length).toBe(0);
    expect(profile.pendingInsights.length).toBe(1);
    await app.close();
  });

  it("rejects storing a secret", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/profile", headers: opAuth, payload: { key: "coinbase_api_key", value: "abc123" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("corrects with the expected version and conflicts on a stale version", async () => {
    const app = await buildApp();
    const created = (await app.inject({ method: "POST", url: "/profile", headers: opAuth, payload: { key: "horizon", value: "long" } })).json();
    const ok = await app.inject({ method: "POST", url: `/profile/${created.id}/correct`, headers: opAuth, payload: { value: "short", expectedVersion: 1 } });
    expect(ok.statusCode).toBe(200);
    const stale = await app.inject({ method: "POST", url: `/profile/${created.id}/correct`, headers: opAuth, payload: { value: "medium", expectedVersion: 1 } });
    expect(stale.statusCode).toBe(409);
    await app.close();
  });

  it("deletes a memory so it leaves the active profile", async () => {
    const app = await buildApp();
    const created = (await app.inject({ method: "POST", url: "/profile", headers: opAuth, payload: { key: "horizon", value: "long" } })).json();
    await app.inject({ method: "DELETE", url: `/profile/${created.id}`, headers: opAuth });
    const profile = (await app.inject({ method: "GET", url: "/profile", headers: opAuth })).json();
    expect(profile.facts.length).toBe(0);
    await app.close();
  });
});
