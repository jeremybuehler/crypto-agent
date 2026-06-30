import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig, logger, type AgentConfig } from "@agent/core";
import { InMemoryOpsState } from "@agent/risk";
import { buildServer } from "../apps/api/src/server";
import { ErrorEnvelopeSchema } from "../apps/api/src/contracts";

const OPERATOR_TOKEN = "operator-".padEnd(40, "x");
const INTERNAL_TOKEN = "internal-".padEnd(40, "y");
const ALLOWED_ORIGIN = "https://dash.example";

beforeAll(() => {
  logger.level = "silent";
});

function testConfig(overrides: Record<string, string> = {}): AgentConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TRADING_MODE: "paper",
    PERSISTENCE_ENABLED: "false",
    OPERATOR_API_TOKEN: OPERATOR_TOKEN,
    INTERNAL_API_TOKEN: INTERNAL_TOKEN,
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ...overrides
  });
}

async function buildApp(overrides: Record<string, string> = {}) {
  const app = await buildServer(testConfig(overrides), { opsState: new InMemoryOpsState() });
  await app.ready();
  return app;
}

const opAuth = { authorization: `Bearer ${OPERATOR_TOKEN}` };
const intAuth = { "x-internal-token": INTERNAL_TOKEN };

describe("liveness is the only unauthenticated route", () => {
  it("serves /health without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("rejects /status with no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers["x-request-id"]).toBeDefined();
    await app.close();
  });

  it("rejects /status with a wrong token and never echoes it", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status", headers: { authorization: "Bearer wrong-token" } });
    expect(res.statusCode).toBe(401);
    expect(res.payload).not.toContain(OPERATOR_TOKEN);
    await app.close();
  });

  it("serves /status with the operator token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status", headers: opAuth });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("paper");
    await app.close();
  });
});

describe("operator and internal boundaries are isolated", () => {
  it("an operator bearer token cannot satisfy an internal route", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/heartbeat",
      headers: opAuth,
      payload: { workerId: "w1", portfolio: {} }
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("an internal token cannot satisfy an operator route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status", headers: intAuth });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("accepts the internal token on the internal route", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/heartbeat",
      headers: intAuth,
      payload: {
        workerId: "worker-1",
        mode: "paper",
        status: "ok",
        version: 1,
        correlationId: "00000000-0000-4000-8000-000000000001",
        observedAt: new Date().toISOString(),
        portfolio: { equityUsd: 1000, cashUsd: 975, dailyPnlPct: 0, totalExposurePct: 2, positions: [] }
      }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("CORS is restricted to allowed origins", () => {
  it("reflects an allowed origin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: ALLOWED_ORIGIN } });
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    await app.close();
  });

  it("does not grant a disallowed origin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});

describe("hardening: headers, body limits, malformed input, rate limits", () => {
  it("sets baseline security headers", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    await app.close();
  });

  it("returns a 400 envelope for malformed JSON", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/heartbeat",
      headers: { ...intAuth, "content-type": "application/json" },
      payload: "{not json"
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    await app.close();
  });

  it("rejects an oversized payload with 413", async () => {
    const app = await buildApp({ API_BODY_LIMIT_BYTES: "256" });
    const res = await app.inject({
      method: "POST",
      url: "/internal/heartbeat",
      headers: { ...intAuth, "content-type": "application/json" },
      payload: JSON.stringify({ blob: "z".repeat(2000) })
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it("rate limits after the configured maximum", async () => {
    const app = await buildApp({ API_RATE_LIMIT_MAX: "3", API_RATE_LIMIT_WINDOW_MS: "60000" });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/status", headers: opAuth });
      codes.push(res.statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    await app.close();
  });
});

describe("config-level security validation", () => {
  it("rejects identical operator and internal tokens", () => {
    expect(() =>
      loadConfig({
        TRADING_MODE: "paper",
        PERSISTENCE_ENABLED: "false",
        OPERATOR_API_TOKEN: "same-token".padEnd(40, "z"),
        INTERNAL_API_TOKEN: "same-token".padEnd(40, "z")
      })
    ).toThrow();
  });

  it("rejects short tokens", () => {
    expect(() =>
      loadConfig({ TRADING_MODE: "paper", PERSISTENCE_ENABLED: "false", OPERATOR_API_TOKEN: "short" })
    ).toThrow();
  });

  it("requires both tokens in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", TRADING_MODE: "paper", PERSISTENCE_ENABLED: "false" })).toThrow();
  });
});
