import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresOperatorRepository } from "@agent/persistence";
import { createMigratedPglite, type PgliteExecutor } from "./support/pglite-executor.js";

let db: PgliteExecutor;
let repo: PostgresOperatorRepository;

async function snap(price: number, at: string): Promise<void> {
  await db.query(
    `INSERT INTO market_snapshots (product_id, price, bid, ask, spread_bps, source_timestamp, created_at)
     VALUES ('BTC-USD', $1, $1, $1, 10, $2, $2)`,
    [price, at]
  );
}

beforeAll(async () => {
  db = await createMigratedPglite();
  repo = new PostgresOperatorRepository(db);
});
afterEach(async () => {
  await db.truncateAll();
});

describe("getCandles", () => {
  it("aggregates market snapshots into OHLC buckets", async () => {
    // Bucket A (12:00:00–12:00:59): open 100, then 105, then 95 -> O100 H105 L95 C95
    await snap(100, "2026-06-30T12:00:05.000Z");
    await snap(105, "2026-06-30T12:00:20.000Z");
    await snap(95, "2026-06-30T12:00:40.000Z");
    // Bucket B (12:01:00–): open 96, close 102
    await snap(96, "2026-06-30T12:01:05.000Z");
    await snap(102, "2026-06-30T12:01:30.000Z");

    const candles = await repo.getCandles("BTC-USD", 60, 10);
    expect(candles.length).toBe(2);
    // returned oldest-first
    expect(candles[0]).toMatchObject({ open: 100, high: 105, low: 95, close: 95 });
    expect(candles[1]).toMatchObject({ open: 96, close: 102 });
    expect(candles[1]!.time).toBeGreaterThan(candles[0]!.time);
  });

  it("filters by product and respects the limit (newest buckets)", async () => {
    await snap(1, "2026-06-30T12:00:05.000Z");
    await snap(2, "2026-06-30T12:01:05.000Z");
    await snap(3, "2026-06-30T12:02:05.000Z");
    await db.query(
      `INSERT INTO market_snapshots (product_id, price, bid, ask, spread_bps, source_timestamp, created_at)
       VALUES ('ETH-USD', 9, 9, 9, 10, '2026-06-30T12:00:05.000Z', '2026-06-30T12:00:05.000Z')`
    );

    const candles = await repo.getCandles("BTC-USD", 60, 2);
    expect(candles.length).toBe(2);
    // the two most recent buckets, oldest-first
    expect(candles[0]!.close).toBe(2);
    expect(candles[1]!.close).toBe(3);
  });

  it("returns an empty array when there is no data", async () => {
    expect(await repo.getCandles("BTC-USD", 60, 10)).toEqual([]);
  });
});
