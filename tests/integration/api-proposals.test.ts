/**
 * End-to-end proposal lifecycle over the API and a real (pglite) database:
 * worker creates a proposal, operator lists/inspects it, then approves with the
 * exact digest. Verifies digest-mismatch and replay are rejected.
 */
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
  const app = await buildServer(testConfig(), {
    opsState: new InMemoryOpsState(),
    operatorRepo: new PostgresOperatorRepository(db)
  });
  await app.ready();
  return app;
}

const proposalBody = {
  preview: {
    productId: "BTC-USD",
    side: "BUY",
    quoteSizeUsd: 25,
    baseSize: 0.0004,
    limitPrice: null,
    estimatedFeeUsd: 0.15,
    estimatedSlippageBps: 5
  },
  ttlSeconds: 300,
  correlationId: "00000000-0000-4000-8000-0000000000d1"
};

beforeAll(async () => {
  db = await createMigratedPglite();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.truncateAll();
});

describe("proposal API lifecycle", () => {
  it("worker creates a proposal that the operator lists and inspects", async () => {
    const app = await buildApp();
    const created = (await app.inject({ method: "POST", url: "/internal/proposal", headers: intAuth, payload: proposalBody })).json();
    expect(created.status).toBe("pending");
    expect(created.digest).toMatch(/^[a-f0-9]{64}$/);

    const list = (await app.inject({ method: "GET", url: "/proposals", headers: opAuth })).json();
    expect(list.proposals.length).toBe(1);
    expect(list.proposals[0].id).toBe(created.id);

    const inspect = (await app.inject({ method: "GET", url: `/proposals/${created.id}`, headers: opAuth })).json();
    expect(inspect.digest).toBe(created.digest);
    await app.close();
  });

  it("approves with the exact digest and rejects replay", async () => {
    const app = await buildApp();
    const created = (await app.inject({ method: "POST", url: "/internal/proposal", headers: intAuth, payload: proposalBody })).json();

    const approve = await app.inject({
      method: "POST",
      url: `/proposals/${created.id}/approve`,
      headers: opAuth,
      payload: { digest: created.digest }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("approved");

    const replay = await app.inject({
      method: "POST",
      url: `/proposals/${created.id}/approve`,
      headers: opAuth,
      payload: { digest: created.digest }
    });
    expect(replay.statusCode).toBe(409);
    await app.close();
  });

  it("rejects an approval whose digest does not match the preview", async () => {
    const app = await buildApp();
    const created = (await app.inject({ method: "POST", url: "/internal/proposal", headers: intAuth, payload: proposalBody })).json();

    const res = await app.inject({
      method: "POST",
      url: `/proposals/${created.id}/approve`,
      headers: opAuth,
      payload: { digest: "0".repeat(64) }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPROVAL_INVALID");
    await app.close();
  });

  it("requires internal auth to create and operator auth to approve", async () => {
    const app = await buildApp();
    const noAuthCreate = await app.inject({ method: "POST", url: "/internal/proposal", payload: proposalBody });
    expect(noAuthCreate.statusCode).toBe(401);

    const created = (await app.inject({ method: "POST", url: "/internal/proposal", headers: intAuth, payload: proposalBody })).json();
    const opUsingIntToken = await app.inject({
      method: "POST",
      url: `/proposals/${created.id}/approve`,
      headers: intAuth,
      payload: { digest: created.digest }
    });
    expect(opUsingIntToken.statusCode).toBe(401);
    await app.close();
  });
});
