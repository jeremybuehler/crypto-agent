import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresOperatorRepository } from "@agent/persistence";
import { computeProposalDigest, type OrderPreview } from "@agent/execution";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

function preview(over: Partial<OrderPreview> = {}): OrderPreview {
  return {
    productId: "BTC-USD",
    side: "BUY",
    quoteSizeUsd: 25,
    baseSize: 0.0004,
    limitPrice: null,
    estimatedFeeUsd: 0.15,
    estimatedSlippageBps: 5,
    ...over
  };
}

let db: PgliteExecutor;
let repo: PostgresOperatorRepository;

async function createProposal(over: { id?: string; expiresAt?: Date; preview?: OrderPreview } = {}) {
  const p = preview(over.preview);
  const id = over.id ?? (await db.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  await repo.createProposal({
    id,
    preview: p,
    digest: computeProposalDigest(p),
    correlationId: "00000000-0000-4000-8000-0000000000c1",
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    expiresAt: over.expiresAt ?? new Date("2026-06-30T12:05:00.000Z")
  });
  return { id, digest: computeProposalDigest(p) };
}

beforeAll(async () => {
  db = await createMigratedPglite();
  repo = new PostgresOperatorRepository(db);
});

afterEach(async () => {
  await db.truncateAll();
});

describe("proposal persistence", () => {
  const now = new Date("2026-06-30T12:01:00.000Z");

  it("creates and reads back an immutable pending proposal", async () => {
    const { id, digest } = await createProposal();
    const p = await repo.getProposal(id);
    expect(p?.status).toBe("pending");
    expect(p?.digest).toBe(digest);
    expect(p?.preview.productId).toBe("BTC-USD");
    expect(p?.preview.quoteSizeUsd).toBeCloseTo(25, 6);
  });

  it("lists pending proposals", async () => {
    await createProposal();
    await createProposal();
    const list = await repo.listProposals(10, ["pending"]);
    expect(list.length).toBe(2);
  });

  it("approves a matching digest exactly once", async () => {
    const { id, digest } = await createProposal();
    const first = await repo.decideProposal({ proposalId: id, decision: "approved", digest, correlationId: "00000000-0000-4000-8000-0000000000c2", now });
    expect(first).toMatchObject({ ok: true, status: "approved" });

    // Replay: the proposal is no longer pending.
    const second = await repo.decideProposal({ proposalId: id, decision: "approved", digest, correlationId: "00000000-0000-4000-8000-0000000000c3", now });
    expect(second).toEqual({ ok: false, reason: "not_pending" });

    const decisions = (await db.query("SELECT count(*)::int AS c FROM proposal_decisions")).rows[0].c;
    expect(decisions).toBe(1);
  });

  it("rejects a digest mismatch and leaves the proposal pending", async () => {
    const { id } = await createProposal();
    const res = await repo.decideProposal({ proposalId: id, decision: "approved", digest: "0".repeat(64), correlationId: "00000000-0000-4000-8000-0000000000c4", now });
    expect(res).toEqual({ ok: false, reason: "digest_mismatch" });
    expect((await repo.getProposal(id))?.status).toBe("pending");
  });

  it("rejects an expired proposal", async () => {
    const { id, digest } = await createProposal({ expiresAt: new Date("2026-06-30T12:00:30.000Z") });
    const res = await repo.decideProposal({ proposalId: id, decision: "approved", digest, correlationId: "00000000-0000-4000-8000-0000000000c5", now });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("records an operator rejection with a reason", async () => {
    const { id } = await createProposal();
    const res = await repo.decideProposal({ proposalId: id, decision: "rejected", reason: "not convinced", correlationId: "00000000-0000-4000-8000-0000000000c6", now });
    expect(res).toMatchObject({ ok: true, status: "rejected" });
    expect((await repo.getProposal(id))?.status).toBe("rejected");
  });

  it("returns not_found for an unknown proposal", async () => {
    const res = await repo.decideProposal({ proposalId: "00000000-0000-4000-8000-0000000000ff", decision: "approved", digest: "0".repeat(64), correlationId: "00000000-0000-4000-8000-0000000000c7", now });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
