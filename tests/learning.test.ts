import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresOperatorRepository, SecretRejectedError, assertNoSecret } from "@agent/persistence";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

let db: PgliteExecutor;
let repo: PostgresOperatorRepository;

function memory(over: Record<string, unknown> = {}) {
  return {
    key: "risk_tolerance",
    value: "conservative",
    scope: "explicit" as const,
    confidence: 1,
    source: "operator",
    observedAt: new Date("2026-06-30T12:00:00.000Z"),
    status: "active" as const,
    actor: "operator" as const,
    ...over
  };
}

beforeAll(async () => {
  db = await createMigratedPglite();
  repo = new PostgresOperatorRepository(db);
});
afterEach(async () => {
  await db.truncateAll();
});

describe("assertNoSecret", () => {
  it("rejects secret-like keys and values", () => {
    expect(() => assertNoSecret("coinbase_api_key", "x")).toThrow(SecretRejectedError);
    expect(() => assertNoSecret("note", "-----BEGIN EC PRIVATE KEY-----")).toThrow(SecretRejectedError);
    expect(() => assertNoSecret("note", "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT")).toThrow(SecretRejectedError);
  });
  it("allows ordinary facts", () => {
    expect(() => assertNoSecret("risk_tolerance", "conservative")).not.toThrow();
  });
});

describe("profile memory persistence", () => {
  it("creates a memory with provenance and lists it as a fact", async () => {
    await repo.upsertMemory(memory());
    const profile = await repo.getProfile();
    expect(profile.facts.length).toBe(1);
    expect(profile.facts[0]?.key).toBe("risk_tolerance");
    expect(profile.facts[0]?.version).toBe(1);
    expect(profile.facts[0]?.source).toBe("operator");
  });

  it("separates derived pending insights from active facts", async () => {
    await repo.upsertMemory(memory());
    await repo.upsertMemory(memory({ key: "prefers_btc", scope: "derived", status: "pending", confidence: 0.6, source: "worker", actor: "worker" }));
    const profile = await repo.getProfile();
    expect(profile.facts.length).toBe(1);
    expect(profile.pendingInsights.length).toBe(1);
    expect(profile.pendingInsights[0]?.scope).toBe("derived");
  });

  it("refuses to store secrets", async () => {
    await expect(repo.upsertMemory(memory({ key: "api_token", value: "abc" }))).rejects.toBeInstanceOf(SecretRejectedError);
  });

  it("corrects with optimistic concurrency", async () => {
    const m = await repo.upsertMemory(memory());
    const ok = await repo.correctMemory({ id: m.id, value: "aggressive", expectedVersion: 1, actor: "operator" });
    expect(ok).toMatchObject({ ok: true, version: 2 });

    const stale = await repo.correctMemory({ id: m.id, value: "moderate", expectedVersion: 1, actor: "operator" });
    expect(stale).toEqual({ ok: false, reason: "version_conflict" });
  });

  it("rejects and soft-deletes, removing items from the active profile", async () => {
    const a = await repo.upsertMemory(memory());
    const b = await repo.upsertMemory(memory({ key: "horizon", value: "long" }));
    await repo.setMemoryStatus(a.id, "rejected", "operator");
    await repo.setMemoryStatus(b.id, "deleted", "operator");
    const profile = await repo.getProfile();
    expect(profile.facts.length).toBe(0);
    // ...but they remain in the full export for auditability.
    expect((await repo.exportMemories()).length).toBe(2);
  });

  it("records history for every change", async () => {
    const m = await repo.upsertMemory(memory());
    await repo.correctMemory({ id: m.id, value: "aggressive", expectedVersion: 1, actor: "operator" });
    const count = (await db.query("SELECT count(*)::int AS c FROM profile_memory_history WHERE memory_id = $1", [m.id])).rows[0].c;
    expect(count).toBe(2); // created + corrected
  });
});
