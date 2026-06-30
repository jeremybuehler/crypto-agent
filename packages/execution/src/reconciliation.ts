/**
 * Reconciliation compares our local view of open orders and positions against
 * what the exchange actually reports. Any divergence is suspicious; a breach
 * (an order the exchange holds that we don't know about, or a position that
 * differs beyond tolerance) must trip the kill switch and alert — we fail
 * closed rather than keep trading on a stale picture.
 *
 * The comparison is pure so it is exhaustively testable; applying the breach
 * (kill switch + alert) is the caller's job.
 */

export interface ReconciliationInput {
  localOpenOrderIds: string[];
  exchangeOpenOrderIds: string[];
  localBaseByProduct: Record<string, number>;
  exchangeBaseByProduct: Record<string, number>;
  /** Fractional tolerance for position differences, e.g. 0.01 = 1%. */
  driftThreshold: number;
}

export interface PositionDrift {
  productId: string;
  local: number;
  exchange: number;
  diff: number;
  exceedsThreshold: boolean;
}

export interface ReconciliationReport {
  ok: boolean;
  breach: boolean;
  orderDrift: { onlyLocal: string[]; onlyExchange: string[] };
  positionDrift: PositionDrift[];
}

function difference(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => !setB.has(x));
}

export function reconcile(input: ReconciliationInput): ReconciliationReport {
  const onlyLocal = difference(input.localOpenOrderIds, input.exchangeOpenOrderIds);
  const onlyExchange = difference(input.exchangeOpenOrderIds, input.localOpenOrderIds);

  const products = new Set([
    ...Object.keys(input.localBaseByProduct),
    ...Object.keys(input.exchangeBaseByProduct)
  ]);

  const positionDrift: PositionDrift[] = [];
  for (const productId of products) {
    const local = input.localBaseByProduct[productId] ?? 0;
    const exchange = input.exchangeBaseByProduct[productId] ?? 0;
    const diff = Math.abs(local - exchange);
    // Relative to the larger magnitude; an unexpected non-zero holding (denominator 0)
    // is always a breach.
    const denom = Math.max(Math.abs(local), Math.abs(exchange));
    const exceedsThreshold = denom === 0 ? diff > 0 : diff / denom > input.driftThreshold;
    if (diff > 0) {
      positionDrift.push({ productId, local, exchange, diff, exceedsThreshold });
    }
  }

  // A breach is anything that could mean we are trading blind: an order the
  // exchange holds that we don't track, or a material position divergence.
  const breach = onlyExchange.length > 0 || positionDrift.some((d) => d.exceedsThreshold);
  const ok = !breach && onlyLocal.length === 0 && positionDrift.length === 0;

  return { ok, breach, orderDrift: { onlyLocal, onlyExchange }, positionDrift };
}
