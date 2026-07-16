/**
 * getTradeStory reconstructs the causal chain for a proposal from the audit
 * trail: market snapshot + AI context (joined by product/time), intent, risk
 * decisions, operator decision, fill, and audit events. Partial chains return
 * partial stories with explicit nulls — never a throw.
 */
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { PostgresOperatorRepository, type ExecutedFillInput } from "@agent/persistence";
import { computeProposalDigest, type OrderPreview } from "@agent/execution";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

let db: PgliteExecutor;
let repo: PostgresOperatorRepository;

const CORR = "00000000-0000-4000-8000-0000000000e1";
const T0 = new Date("2026-07-15T12:00:00.000Z");

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

async function uuid(): Promise<string> {
  return (await db.query("SELECT gen_random_uuid() AS id")).rows[0]!.id as string;
}

async function seedIntent(): Promise<string> {
  const id = await uuid();
  await db.query(
    `INSERT INTO trade_intents (id, product_id, side, quote_size_usd, confidence, reason_code, rationale, strategy_version, created_at)
     VALUES ($1, 'BTC-USD', 'BUY', 25, 0.6, 'trend_up_confirmed', 'Fast EMA above slow EMA.', 'trend-1', $2)`,
    [id, T0]
  );
  return id;
}

async function seedPipelineContext(): Promise<void> {
  const before = new Date(T0.getTime() - 5_000);
  await db.query(
    `INSERT INTO market_snapshots (product_id, price, bid, ask, spread_bps, source_timestamp, created_at)
     VALUES ('BTC-USD', 100.5, 100.4, 100.6, 10, $1, $1)`,
    [before]
  );
  await db.query(
    `INSERT INTO ai_contexts (product_id, timeframe, input_json, output_json, market_regime, confidence, do_not_trade, created_at)
     VALUES ('BTC-USD', '1m', '{}', '{"summary":"calm uptrend"}', 'trend', 0.7, false, $1)`,
    [before]
  );
}

async function seedRiskDecision(intentId: string, approved: boolean): Promise<void> {
  await db.query(
    `INSERT INTO risk_decisions (trade_intent_id, approved, reasons, rule_results, checked_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      intentId,
      approved,
      JSON.stringify(approved ? [] : ["Daily PnL breached."]),
      JSON.stringify([{ rule: "daily_loss", passed: approved, message: "checked" }]),
      T0
    ]
  );
}

async function seedProposal(intentId: string | null): Promise<{ id: string; digest: string }> {
  const id = await uuid();
  const p = preview();
  const digest = computeProposalDigest(p);
  await repo.createProposal({
    id,
    tradeIntentId: intentId,
    preview: p,
    digest,
    correlationId: CORR,
    createdAt: new Date(T0.getTime() + 1_000),
    expiresAt: new Date(T0.getTime() + 600_000)
  });
  return { id, digest };
}

function fillFor(proposalId: string, tradeIntentId: string): ExecutedFillInput {
  return {
    fillId: "22222222-2222-4222-8222-222222222222",
    tradeIntentId,
    proposalId,
    productId: "BTC-USD",
    side: "BUY",
    quoteSizeUsd: 25,
    price: 100.7,
    baseSize: 0.248,
    feeUsd: 0.15,
    filledAt: new Date(T0.getTime() + 120_000),
    mode: "sandbox",
    exchangeOrderId: "exch-story-1",
    clientOrderId: proposalId
  };
}

beforeAll(async () => {
  db = await createMigratedPglite();
  repo = new PostgresOperatorRepository(db);
});

afterEach(async () => {
  await db.truncateAll();
});

describe("getTradeStory", () => {
  it("reconstructs the full chain for an executed trade", async () => {
    await seedPipelineContext();
    const intentId = await seedIntent();
    await seedRiskDecision(intentId, true);
    const { id, digest } = await seedProposal(intentId);
    await repo.decideProposal({
      proposalId: id,
      decision: "approved",
      digest,
      correlationId: CORR,
      now: new Date(T0.getTime() + 60_000)
    });
    await repo.claimNextApprovedProposal(new Date(T0.getTime() + 90_000));
    await repo.markProposalExecuted({
      proposalId: id,
      fill: fillFor(id, intentId),
      auditId: "33333333-3333-4333-8333-333333333333",
      correlationId: id,
      now: new Date(T0.getTime() + 121_000)
    });

    const story = await repo.getTradeStory(id);

    expect(story.proposal?.status).toBe("executed");
    expect(story.proposal?.exchangeOrderId).toBe("exch-story-1");
    expect(story.operatorDecision?.decision).toBe("approved");
    expect(story.intent?.rationale).toBe("Fast EMA above slow EMA.");
    expect(story.riskDecisions).toHaveLength(1);
    expect(story.riskDecisions[0]!.ruleResults[0]!.rule).toBe("daily_loss");
    expect(story.fill?.price).toBe(100.7);
    expect(story.fill?.mode).toBe("sandbox");
    expect(story.aiContext?.marketRegime).toBe("trend");
    expect(story.aiContext?.output).toMatchObject({ summary: "calm uptrend" });
    expect(story.marketSnapshot?.price).toBe(100.5);
    expect(story.auditEvents.some((e) => e.type === "proposal.executed")).toBe(true);
  });

  it("returns a partial story for a bare pending proposal", async () => {
    const { id } = await seedProposal(null);

    const story = await repo.getTradeStory(id);

    expect(story.proposal?.status).toBe("pending");
    expect(story.operatorDecision).toBeNull();
    expect(story.intent).toBeNull();
    expect(story.riskDecisions).toEqual([]);
    expect(story.fill).toBeNull();
    // No snapshots seeded — market context is honestly absent.
    expect(story.marketSnapshot).toBeNull();
    expect(story.aiContext).toBeNull();
  });

  it("returns all-null sections for an unknown id rather than throwing", async () => {
    const story = await repo.getTradeStory("99999999-9999-4999-8999-999999999999");
    expect(story.proposal).toBeNull();
    expect(story.intent).toBeNull();
    expect(story.fill).toBeNull();
    expect(story.auditEvents).toEqual([]);
  });
});
