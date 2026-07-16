/**
 * /assistant/ask over the API: operator auth required, request schema
 * validated, and — with no ANTHROPIC_API_KEY — the deterministic fallback
 * answers from real repository data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AgentConfig } from "@agent/core";
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
    // deliberately no ANTHROPIC_API_KEY → deterministic fallback
  });
}

let db: PgliteExecutor;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  db = await createMigratedPglite();
  app = await buildServer(testConfig(), {
    opsState: new InMemoryOpsState(),
    operatorRepo: new PostgresOperatorRepository(db)
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe("POST /assistant/ask", () => {
  const body = { question: "what is slippage?", learner: { id: "hunter", name: "Hunter", level: "beginner" } };

  it("requires operator auth", async () => {
    const res = await app.inject({ method: "POST", url: "/assistant/ask", payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assistant/ask",
      headers: opAuth,
      payload: { question: "", learner: { id: "", name: "", level: "wizard" } }
    });
    expect(res.statusCode).toBe(400);
  });

  it("answers a glossary question deterministically without an Anthropic key", async () => {
    const res = await app.inject({ method: "POST", url: "/assistant/ask", headers: opAuth, payload: body });
    expect(res.statusCode).toBe(200);
    const parsed = res.json();
    expect(parsed.fallback).toBe(true);
    expect(parsed.answer).toContain("price you expected");
    expect(parsed.toolsUsed).toContain("define_term");
  });

  it("serves a trade story by correlation id from the repository", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assistant/ask",
      headers: opAuth,
      payload: { ...body, question: "explain this trade", correlationId: "99999999-9999-4999-8999-999999999999" }
    });
    expect(res.statusCode).toBe(200);
    const parsed = res.json();
    // Unknown id → honest all-null story, still a 200 teaching moment.
    expect(parsed.answer).toContain('"proposal": null');
  });
});
