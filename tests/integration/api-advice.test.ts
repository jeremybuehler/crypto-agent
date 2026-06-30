import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";
import { PostgresOperatorRepository } from "@agent/persistence";
import { buildServer } from "../../apps/api/src/server.js";
import { createMigratedPglite, type PgliteExecutor } from "../support/pglite-executor.js";

const OPERATOR_TOKEN = "operator-".padEnd(40, "x");
const INTERNAL_TOKEN = "internal-".padEnd(40, "y");
const opAuth = { authorization: `Bearer ${OPERATOR_TOKEN}` };

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
async function seedProfile(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.inject({ method: "POST", url: "/profile", headers: opAuth, payload: { key: "risk_tolerance", value: "conservative" } });
}

beforeAll(async () => { db = await createMigratedPglite(); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.truncateAll(); });

describe("advice API", () => {
  it("refuses advice until a profile is confirmed", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/advice", headers: opAuth, payload: { question: "How should I allocate?" } });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("returns sourced advice with disclaimers once a profile exists", async () => {
    const app = await buildApp();
    await seedProfile(app);
    const res = await app.inject({ method: "POST", url: "/advice", headers: opAuth, payload: { question: "How should I think about allocation?" } });
    expect(res.statusCode).toBe(200);
    const advice = res.json();
    expect(advice.jurisdiction).toBe("US");
    expect(advice.disclaimers.length).toBeGreaterThanOrEqual(1);
    expect(advice.sources.length).toBeGreaterThanOrEqual(1);
    // The advice payload has no execution affordance.
    expect("execute" in advice).toBe(false);
    await app.close();
  });

  it("refuses unsafe requests with a 400", async () => {
    const app = await buildApp();
    await seedProfile(app);
    const res = await app.inject({ method: "POST", url: "/advice", headers: opAuth, payload: { question: "What is a guaranteed 10x?" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("persists the advice record", async () => {
    const app = await buildApp();
    await seedProfile(app);
    await app.inject({ method: "POST", url: "/advice", headers: opAuth, payload: { question: "How should I think about allocation?" } });
    const count = (await db.query("SELECT count(*)::int AS c FROM advice_records")).rows[0].c;
    expect(count).toBe(1);
    await app.close();
  });
});
