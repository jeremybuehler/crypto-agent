/**
 * A minimal database seam so repositories can run against a real `pg.Pool` in
 * production and an embedded pglite instance in tests, without depending on
 * either driver directly.
 *
 *  - `query` runs a single parameterized statement.
 *  - `exec` runs a multi-statement SQL string (used for migration files).
 *  - `transaction` runs a callback against a single connection wrapped in
 *    BEGIN/COMMIT, rolling back on any thrown error.
 */
import type pg from "pg";

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

export interface SqlExecutor extends Queryable {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Production executor backed by a node-postgres pool. */
export function createPgExecutor(pool: pg.Pool): SqlExecutor {
  return {
    async query(text, values) {
      const result = await pool.query(text, values as unknown[] | undefined);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({
          async query(text, values) {
            const result = await client.query(text, values as unknown[] | undefined);
            return { rows: result.rows as Array<Record<string, unknown>> };
          }
        });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
