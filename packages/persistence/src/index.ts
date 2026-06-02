import type { AIContext, AIContextInput } from "@agent/ai";
import type { MarketSnapshot, RiskDecision, TradeIntent } from "@agent/core";
import type { SimulatedFill } from "@agent/execution";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

export interface PersistenceRepository {
  migrate(): Promise<void>;
  saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void>;
  saveAIContext(record: AIContextRecord): Promise<void>;
  saveTradeIntent(intent: TradeIntent): Promise<void>;
  saveRiskDecision(decision: RiskDecision): Promise<void>;
  savePaperFill(record: PaperFillRecord): Promise<void>;
  close(): Promise<void>;
}

export interface AIContextRecord {
  productId: string;
  timeframe: string;
  input: AIContextInput;
  output: AIContext;
}

export interface PaperFillRecord {
  tradeIntentId: string;
  fill: SimulatedFill;
}

export class NoopPersistenceRepository implements PersistenceRepository {
  async migrate(): Promise<void> {}
  async saveMarketSnapshot(): Promise<void> {}
  async saveAIContext(): Promise<void> {}
  async saveTradeIntent(): Promise<void> {}
  async saveRiskDecision(): Promise<void> {}
  async savePaperFill(): Promise<void> {}
  async close(): Promise<void> {}
}

export class PostgresPersistenceRepository implements PersistenceRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async migrate(): Promise<void> {
    const migrationPath = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations/001_trading_audit.sql");
    const sql = await readFile(migrationPath, "utf8");
    await this.pool.query(sql);
  }

  async saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    const query = buildMarketSnapshotInsert(snapshot);
    await this.pool.query(query.text, query.values);
  }

  async saveAIContext(record: AIContextRecord): Promise<void> {
    const query = buildAIContextInsert(record);
    await this.pool.query(query.text, query.values);
  }

  async saveTradeIntent(intent: TradeIntent): Promise<void> {
    const query = buildTradeIntentInsert(intent);
    await this.pool.query(query.text, query.values);
  }

  async saveRiskDecision(decision: RiskDecision): Promise<void> {
    const query = buildRiskDecisionInsert(decision);
    await this.pool.query(query.text, query.values);
  }

  async savePaperFill(record: PaperFillRecord): Promise<void> {
    const query = buildPaperFillInsert(record);
    await this.pool.query(query.text, query.values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPersistenceRepository(options: {
  enabled: boolean;
  databaseUrl?: string | undefined;
}): PersistenceRepository {
  if (!options.enabled) {
    return new NoopPersistenceRepository();
  }

  if (!options.databaseUrl) {
    throw new Error("Persistence is enabled but DATABASE_URL was not provided.");
  }

  return new PostgresPersistenceRepository(options.databaseUrl);
}

export function buildMarketSnapshotInsert(snapshot: MarketSnapshot) {
  return {
    text: `
      INSERT INTO market_snapshots (product_id, price, bid, ask, spread_bps, source_timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    values: [
      snapshot.productId,
      snapshot.price,
      snapshot.bid,
      snapshot.ask,
      snapshot.spreadBps,
      snapshot.timestamp
    ]
  };
}

export function buildAIContextInsert(record: AIContextRecord) {
  return {
    text: `
      INSERT INTO ai_contexts (
        product_id,
        timeframe,
        input_json,
        output_json,
        market_regime,
        confidence,
        do_not_trade
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    values: [
      record.productId,
      record.timeframe,
      record.input,
      record.output,
      record.output.marketRegime,
      record.output.confidence,
      record.output.doNotTrade
    ]
  };
}

export function buildTradeIntentInsert(intent: TradeIntent) {
  return {
    text: `
      INSERT INTO trade_intents (
        id,
        product_id,
        side,
        quote_size_usd,
        confidence,
        reason_code,
        rationale,
        strategy_version,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `,
    values: [
      intent.id,
      intent.productId,
      intent.side,
      intent.quoteSizeUsd,
      intent.confidence,
      intent.reasonCode,
      intent.rationale,
      intent.strategyVersion,
      intent.createdAt
    ]
  };
}

export function buildRiskDecisionInsert(decision: RiskDecision) {
  return {
    text: `
      INSERT INTO risk_decisions (
        trade_intent_id,
        approved,
        reasons,
        rule_results,
        checked_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    values: [
      decision.intent.id,
      decision.approved,
      decision.reasons,
      decision.ruleResults,
      decision.checkedAt
    ]
  };
}

export function buildPaperFillInsert(record: PaperFillRecord) {
  return {
    text: `
      INSERT INTO paper_fills (
        id,
        trade_intent_id,
        product_id,
        side,
        quote_size_usd,
        price,
        base_size,
        fee_usd,
        filled_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `,
    values: [
      record.fill.fillId,
      record.tradeIntentId,
      record.fill.productId,
      record.fill.side,
      record.fill.quoteSizeUsd,
      record.fill.price,
      record.fill.baseSize,
      record.fill.feeUsd,
      record.fill.filledAt
    ]
  };
}
