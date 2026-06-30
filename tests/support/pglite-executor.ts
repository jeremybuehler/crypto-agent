/**
 * Test-only SqlExecutor backed by an embedded pglite instance. Lets the real
 * Postgres repositories run against an in-process Postgres (no Docker), so
 * repository and API↔DB integration tests exercise actual SQL and transactions.
 *
 * pglite ships Postgres 16, where `gen_random_uuid()` is a core function, so the
 * `CREATE EXTENSION ... pgcrypto` line in the migration files (kept for real
 * Postgres) is stripped here — pglite does not bundle that contrib extension.
 */
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor, Queryable } from "@agent/persistence";
import { runMigrations } from "@agent/persistence";

const PGCRYPTO_STATEMENT = /CREATE\s+EXTENSION[^;]*pgcrypto[^;]*;/gi;

export interface PgliteExecutor extends SqlExecutor {
  truncateAll(): Promise<void>;
}

export function createPgliteExecutor(): PgliteExecutor {
  const db = new PGlite();

  const wrap = (q: { query: PGlite["query"] }): Queryable => ({
    async query(text, values) {
      const result = await q.query(text, values as unknown[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    }
  });

  return {
    async query(text, values) {
      const result = await db.query(text, values as unknown[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    async exec(sql) {
      await db.exec(sql.replace(PGCRYPTO_STATEMENT, ""));
    },
    async transaction(fn) {
      return db.transaction(async (tx) => fn(wrap(tx as unknown as { query: PGlite["query"] })));
    },
    async close() {
      await db.close();
    },
    async truncateAll() {
      await db.exec(
        `TRUNCATE profile_memory_history, profile_memories, proposal_decisions, proposals,
                  portfolio_snapshots, worker_heartbeats, audit_events, paper_fills,
                  risk_decisions, trade_intents, ai_contexts, market_snapshots
                  RESTART IDENTITY CASCADE;`
      );
    }
  };
}

/** Create a pglite executor with all migrations applied. */
export async function createMigratedPglite(): Promise<PgliteExecutor> {
  const executor = createPgliteExecutor();
  await runMigrations(executor);
  return executor;
}
