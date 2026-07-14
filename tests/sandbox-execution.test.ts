/**
 * Execution-lifecycle repository tests: the atomic claim (approved -> executing),
 * the transactional mark-executed (status + real fill + audit, idempotent), and
 * mark-failed. Run against embedded pglite so the actual SQL, the partial-unique
 * idempotency index, and the status guards are exercised.
 */
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { PostgresOperatorRepository, type ExecutedFillInput } from "@agent/persistence";
import { computeProposalDigest, type OrderPreview } from "@agent/execution";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

let db: PgliteExecutor;
let repo: PostgresOperatorRepository;

const CORR = "00000000-0000-4000-8000-0000000000d1";

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

/** Seed a trade intent so the fill's NOT NULL foreign key is satisfiable. */
async function seedTradeIntent(): Promise<string> {
  const id = (await db.query("SELECT gen_random_uuid() AS id")).rows[0]!.id as string;
  await db.query(
    `INSERT INTO trade_intents (id, product_id, side, quote_size_usd, confidence, reason_code, rationale, strategy_version, created_at)
     VALUES ($1, 'BTC-USD', 'BUY', 25, 1, 'test', 'seed', '', now())`,
    [id]
  );
  return id;
}

/** Create an approved proposal ready to claim. Returns its id + trade intent id. */
async function approvedProposal(): Promise<{ id: string; tradeIntentId: string }> {
  const tradeIntentId = await seedTradeIntent();
  const p = preview();
  const id = (await db.query("SELECT gen_random_uuid() AS id")).rows[0]!.id as string;
  const digest = computeProposalDigest(p);
  await repo.createProposal({
    id,
    tradeIntentId,
    preview: p,
    digest,
    correlationId: CORR,
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    expiresAt: new Date("2026-06-30T12:05:00.000Z")
  });
  const decided = await repo.decideProposal({
    proposalId: id,
    decision: "approved",
    digest,
    correlationId: CORR,
    now: new Date("2026-06-30T12:01:00.000Z")
  });
  expect(decided.ok).toBe(true);
  return { id, tradeIntentId };
}

function fillFor(proposalId: string, tradeIntentId: string, over: Partial<ExecutedFillInput> = {}): ExecutedFillInput {
  return {
    fillId: "11111111-1111-4111-8111-111111111111",
    tradeIntentId,
    proposalId,
    productId: "BTC-USD",
    side: "BUY",
    quoteSizeUsd: 25,
    price: 60000,
    baseSize: 0.0004,
    feeUsd: 0.15,
    filledAt: new Date("2026-06-30T12:02:00.000Z"),
    mode: "sandbox",
    exchangeOrderId: "exch-1",
    clientOrderId: proposalId,
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

describe("proposal execution lifecycle", () => {
  const now = new Date("2026-06-30T12:02:00.000Z");

  it("returns null when nothing is approved", async () => {
    expect(await repo.claimNextApprovedProposal(now)).toBeNull();
  });

  it("claims an approved proposal exactly once and carries the trade intent id", async () => {
    const { id, tradeIntentId } = await approvedProposal();

    // Concurrent claimers: exactly one wins, the row ends `executing`.
    const results = await Promise.all([
      repo.claimNextApprovedProposal(now),
      repo.claimNextApprovedProposal(now),
      repo.claimNextApprovedProposal(now)
    ]);
    const claimed = results.filter((r) => r !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(id);
    expect(claimed[0]!.tradeIntentId).toBe(tradeIntentId);
    expect((await repo.getProposal(id))!.status).toBe("executing");
  });

  it("marks executed: flips status, writes one fill, and is idempotent", async () => {
    const { id, tradeIntentId } = await approvedProposal();
    await repo.claimNextApprovedProposal(now);

    await repo.markProposalExecuted({
      proposalId: id,
      fill: fillFor(id, tradeIntentId),
      auditId: "22222222-2222-4222-8222-222222222221",
      correlationId: CORR,
      now
    });
    expect((await repo.getProposal(id))!.status).toBe("executed");

    // A duplicate call (e.g. crash-retry) must not write a second fill.
    await repo.markProposalExecuted({
      proposalId: id,
      fill: fillFor(id, tradeIntentId, { fillId: "33333333-3333-4333-8333-333333333333" }),
      auditId: "22222222-2222-4222-8222-222222222222",
      correlationId: CORR,
      now
    });

    const fills = await repo.listRecentFills(10);
    expect(fills).toHaveLength(1);
    const row = (await db.query("SELECT mode, exchange_order_id, proposal_id FROM paper_fills")).rows[0]!;
    expect(row.mode).toBe("sandbox");
    expect(row.exchange_order_id).toBe("exch-1");
    expect(row.proposal_id).toBe(id);

    const audit = await repo.listAuditEvents(10);
    expect(audit.some((e) => e.type === "proposal.executed")).toBe(true);
  });

  it("mark-executed on a non-executing proposal is a no-op (no fill, no flip)", async () => {
    const { id, tradeIntentId } = await approvedProposal();
    // Not claimed -> still `approved`, not `executing`.
    await repo.markProposalExecuted({
      proposalId: id,
      fill: fillFor(id, tradeIntentId),
      auditId: "22222222-2222-4222-8222-222222222223",
      correlationId: CORR,
      now
    });
    expect((await repo.getProposal(id))!.status).toBe("approved");
    expect(await repo.listRecentFills(10)).toHaveLength(0);
  });

  it("marks execution failed from executing and records an audit event", async () => {
    const { id } = await approvedProposal();
    await repo.claimNextApprovedProposal(now);

    await repo.markProposalExecutionFailed({
      proposalId: id,
      reason: "exchange rejected",
      auditId: "44444444-4444-4444-8444-444444444444",
      correlationId: CORR,
      now
    });
    expect((await repo.getProposal(id))!.status).toBe("execution_failed");
    const audit = await repo.listAuditEvents(10);
    expect(audit.some((e) => e.type === "proposal.execution_failed")).toBe(true);
  });
});
