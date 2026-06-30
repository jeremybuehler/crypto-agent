import type { AIContext, AIContextInput } from "@agent/ai";
import type { MarketSnapshot, RiskDecision, TradeIntent } from "@agent/core";
import type { SimulatedFill } from "@agent/execution";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export * from "./sql-executor.js";
export * from "./operator-repository.js";
export * from "./learning-memory.js";
import { createPgExecutor, type SqlExecutor } from "./sql-executor.js";
import {
  InMemoryOperatorRepository,
  PostgresOperatorRepository,
  type OperatorRepository
} from "./operator-repository.js";

const { Pool } = pg;

/**
 * Build an operator repository from runtime config: a Postgres-backed repo when
 * persistence is enabled, otherwise an in-memory repo (hermetic tests / dev).
 */
export function createOperatorRepositoryForConfig(options: {
  enabled: boolean;
  databaseUrl?: string | undefined;
}): OperatorRepository {
  if (!options.enabled) {
    return new InMemoryOperatorRepository();
  }
  if (!options.databaseUrl) {
    throw new Error("Persistence is enabled but DATABASE_URL was not provided.");
  }
  return new PostgresOperatorRepository(createPgExecutor(new Pool({ connectionString: options.databaseUrl })));
}

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * Apply every `NNN_*.sql` migration not yet recorded in `schema_migrations`, in
 * filename order, each inside its own transaction. Idempotent: already-applied
 * versions are skipped, so it is safe to run on every boot.
 */
export async function runMigrations(executor: SqlExecutor): Promise<void> {
  await executor.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );`
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied = await executor.query("SELECT version FROM schema_migrations");
  const done = new Set(applied.rows.map((row) => row.version as string));

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), "utf8");
    // Migration files are multi-statement and all idempotent (IF NOT EXISTS),
    // so exec the body, then record the version last. Re-running after a crash
    // mid-file re-execs harmlessly and then records the version.
    await executor.exec(sql);
    await executor.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [
      version
    ]);
  }
}

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
    await runMigrations(createPgExecutor(this.pool));
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
      // JSONB params must be JSON strings: node-postgres encodes a raw JS object
      // acceptably but a JS array as a Postgres array literal, so stringify
      // explicitly to be driver-agnostic and avoid 22P02 on jsonb columns.
      JSON.stringify(record.input),
      JSON.stringify(record.output),
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
      // reasons / rule_results are arrays bound to jsonb columns; stringify so
      // node-postgres sends JSON, not a Postgres array literal (see 22P02).
      JSON.stringify(decision.reasons),
      JSON.stringify(decision.ruleResults),
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
