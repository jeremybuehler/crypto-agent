import { describe, expect, it } from "vitest";
import {
  computeProposalDigest,
  evaluateApproval,
  type OrderPreview,
  type StoredProposal
} from "@agent/execution";

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

function proposal(over: Partial<StoredProposal> = {}): StoredProposal {
  const p = preview(over.preview);
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "pending",
    preview: p,
    digest: computeProposalDigest(p),
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    expiresAt: new Date("2026-06-30T12:05:00.000Z"),
    ...over
  };
}

describe("computeProposalDigest", () => {
  it("is deterministic and independent of key order", () => {
    const a = computeProposalDigest(preview());
    const b = computeProposalDigest({
      estimatedSlippageBps: 5,
      limitPrice: null,
      side: "BUY",
      productId: "BTC-USD",
      baseSize: 0.0004,
      quoteSizeUsd: 25,
      estimatedFeeUsd: 0.15
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any preview field changes", () => {
    expect(computeProposalDigest(preview())).not.toBe(computeProposalDigest(preview({ quoteSizeUsd: 26 })));
  });
});

describe("evaluateApproval", () => {
  const now = new Date("2026-06-30T12:01:00.000Z");

  it("accepts a matching digest on a pending, unexpired proposal", () => {
    const p = proposal();
    expect(evaluateApproval(p, p.digest, now)).toEqual({ ok: true });
  });

  it("rejects a digest mismatch (changed preview)", () => {
    const p = proposal();
    expect(evaluateApproval(p, "0".repeat(64), now)).toEqual({ ok: false, reason: "digest_mismatch" });
  });

  it("rejects an expired proposal", () => {
    const p = proposal();
    const late = new Date("2026-06-30T12:06:00.000Z");
    expect(evaluateApproval(p, p.digest, late)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a non-pending proposal (replay / already decided)", () => {
    const p = proposal({ status: "approved" });
    expect(evaluateApproval(p, p.digest, now)).toEqual({ ok: false, reason: "not_pending" });
  });
});
