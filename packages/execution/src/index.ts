import type { Clock, MarketSnapshot, PortfolioState, RiskDecision } from "@agent/core";
import { SystemClock } from "@agent/core";
import { randomUUID } from "node:crypto";

export interface SimulatedFill {
  fillId: string;
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: Date;
}

export class PaperBroker {
  constructor(
    private readonly feeRate = 0.006,
    private readonly slippageBps = 10,
    private readonly clock: Clock = SystemClock
  ) {}

  execute(decision: RiskDecision, market: MarketSnapshot, portfolio: PortfolioState): { fill: SimulatedFill; portfolio: PortfolioState } {
    if (!decision.approved) {
      throw new Error(`Cannot execute rejected risk decision: ${decision.reasons.join("; ")}`);
    }

    const slippageMultiplier = decision.intent.side === "BUY" ? 1 + this.slippageBps / 10_000 : 1 - this.slippageBps / 10_000;
    const price = market.price * slippageMultiplier;
    const feeUsd = decision.intent.quoteSizeUsd * this.feeRate;
    const baseSize = decision.intent.quoteSizeUsd / price;
    const signedBaseSize = decision.intent.side === "BUY" ? baseSize : -baseSize;
    const signedNotional = decision.intent.side === "BUY" ? decision.intent.quoteSizeUsd : -decision.intent.quoteSizeUsd;

    const existing = portfolio.positions.find((position) => position.productId === decision.intent.productId);
    const positions = portfolio.positions.filter((position) => position.productId !== decision.intent.productId);
    const updatedBaseSize = (existing?.baseSize ?? 0) + signedBaseSize;
    const updatedNotional = Math.max(0, (existing?.notionalUsd ?? 0) + signedNotional);

    if (updatedBaseSize > 0.00000001 && updatedNotional > 0) {
      positions.push({
        productId: decision.intent.productId,
        baseSize: updatedBaseSize,
        notionalUsd: updatedNotional,
        exposurePct: (updatedNotional / portfolio.equityUsd) * 100,
        averageEntryPrice: existing?.averageEntryPrice ?? price
      });
    }

    return {
      fill: {
        fillId: randomUUID(),
        productId: decision.intent.productId,
        side: decision.intent.side,
        quoteSizeUsd: decision.intent.quoteSizeUsd,
        price,
        baseSize,
        feeUsd,
        filledAt: this.clock.now()
      },
      portfolio: {
        ...portfolio,
        cashUsd: portfolio.cashUsd - signedNotional - feeUsd,
        totalExposurePct: positions.reduce((sum, position) => sum + position.exposurePct, 0),
        positions
      }
    };
  }
}
