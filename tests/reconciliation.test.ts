import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcile, type ReconciliationInput } from "@agent/execution";

function input(over: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    localOpenOrderIds: [],
    exchangeOpenOrderIds: [],
    localBaseByProduct: {},
    exchangeBaseByProduct: {},
    driftThreshold: 0.01,
    ...over
  };
}

describe("reconcile", () => {
  it("is ok when local and exchange agree", () => {
    const r = reconcile(input({
      localOpenOrderIds: ["o1"],
      exchangeOpenOrderIds: ["o1"],
      localBaseByProduct: { "BTC-USD": 0.5 },
      exchangeBaseByProduct: { "BTC-USD": 0.5 }
    }));
    expect(r.ok).toBe(true);
    expect(r.breach).toBe(false);
  });

  it("breaches when the exchange reports an order we do not know about", () => {
    const r = reconcile(input({ localOpenOrderIds: [], exchangeOpenOrderIds: ["ghost"] }));
    expect(r.orderDrift.onlyExchange).toEqual(["ghost"]);
    expect(r.breach).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("flags but does not breach on a tiny position difference within tolerance", () => {
    const r = reconcile(input({
      localBaseByProduct: { "BTC-USD": 1.0 },
      exchangeBaseByProduct: { "BTC-USD": 1.005 }, // 0.5% < 1% threshold
      driftThreshold: 0.01
    }));
    expect(r.breach).toBe(false);
  });

  it("breaches when a position difference exceeds the threshold", () => {
    const r = reconcile(input({
      localBaseByProduct: { "BTC-USD": 1.0 },
      exchangeBaseByProduct: { "BTC-USD": 1.5 }, // 50% > 1%
      driftThreshold: 0.01
    }));
    const drift = r.positionDrift.find((d) => d.productId === "BTC-USD");
    expect(drift?.exceedsThreshold).toBe(true);
    expect(r.breach).toBe(true);
  });

  it("treats a product the exchange holds but we don't as a breach", () => {
    const r = reconcile(input({
      localBaseByProduct: {},
      exchangeBaseByProduct: { "ETH-USD": 2 },
      driftThreshold: 0.01
    }));
    expect(r.breach).toBe(true);
  });

  it("property: identical state never breaches", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom("BTC-USD", "ETH-USD"), fc.double({ min: 0, max: 1000, noNaN: true })),
        fc.array(fc.string()),
        (positions, orders) => {
          const r = reconcile(input({
            localOpenOrderIds: orders,
            exchangeOpenOrderIds: orders,
            localBaseByProduct: positions,
            exchangeBaseByProduct: positions
          }));
          expect(r.breach).toBe(false);
        }
      )
    );
  });
});
