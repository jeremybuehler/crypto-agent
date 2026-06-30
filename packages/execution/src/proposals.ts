/**
 * Interactive proposals: when a strategy-generated order requires operator
 * approval, the worker emits an immutable proposal instead of filling it. The
 * operator approves the EXACT preview by its digest; a changed preview produces
 * a different digest, so an approval is non-transferable and cannot be replayed
 * against a different order.
 *
 * Digest and approval evaluation are pure so they are trivially testable and
 * identical on both the worker (which computes) and the API (which verifies).
 */
import { createHash } from "node:crypto";
import type { MarketSnapshot, TradeIntent } from "@agent/core";

export interface OrderPreview {
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  baseSize: number;
  limitPrice: number | null;
  estimatedFeeUsd: number;
  estimatedSlippageBps: number;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";

export interface StoredProposal {
  id: string;
  status: ProposalStatus;
  preview: OrderPreview;
  digest: string;
  createdAt: Date;
  expiresAt: Date;
}

export type ApprovalRejection = "not_pending" | "expired" | "digest_mismatch";
export type ApprovalResult = { ok: true } | { ok: false; reason: ApprovalRejection };

/**
 * Build an order preview from an approved intent and the current market, using
 * the same fee/slippage assumptions as the paper broker so the preview the
 * operator approves matches what would actually fill.
 */
export function previewOrder(
  intent: TradeIntent,
  market: MarketSnapshot,
  opts: { feeRate?: number; slippageBps?: number } = {}
): OrderPreview {
  const feeRate = opts.feeRate ?? 0.006;
  const slippageBps = opts.slippageBps ?? 10;
  const slippageMultiplier = intent.side === "BUY" ? 1 + slippageBps / 10_000 : 1 - slippageBps / 10_000;
  const price = market.price * slippageMultiplier;
  return {
    productId: intent.productId,
    side: intent.side,
    quoteSizeUsd: intent.quoteSizeUsd,
    baseSize: intent.quoteSizeUsd / price,
    limitPrice: null,
    estimatedFeeUsd: intent.quoteSizeUsd * feeRate,
    estimatedSlippageBps: slippageBps
  };
}

/**
 * Canonical sha256 digest of a preview. Keys are sorted so the digest is
 * independent of property order, and only the fields that define the order are
 * included — approving a digest means approving exactly these numbers.
 */
export function computeProposalDigest(preview: OrderPreview): string {
  const canonical = JSON.stringify({
    baseSize: preview.baseSize,
    estimatedFeeUsd: preview.estimatedFeeUsd,
    estimatedSlippageBps: preview.estimatedSlippageBps,
    limitPrice: preview.limitPrice,
    productId: preview.productId,
    quoteSizeUsd: preview.quoteSizeUsd,
    side: preview.side
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Decide whether an approval request is valid. Fails closed: a non-pending
 * proposal (already decided, executed, cancelled, or expired), an expired
 * window, or a digest that does not match the stored preview are all rejected.
 */
export function evaluateApproval(proposal: StoredProposal, digest: string, now: Date): ApprovalResult {
  if (proposal.status !== "pending") return { ok: false, reason: "not_pending" };
  if (now.getTime() > proposal.expiresAt.getTime()) return { ok: false, reason: "expired" };
  if (digest !== proposal.digest) return { ok: false, reason: "digest_mismatch" };
  return { ok: true };
}
