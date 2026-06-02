import type { AIContext } from "@agent/ai";
import type { AgentConfig, PortfolioState, TradeIntent } from "@agent/core";
import type { FeatureSnapshot } from "@agent/market-data";
import { randomUUID } from "node:crypto";

export interface StrategyInput {
  config: AgentConfig;
  features: FeatureSnapshot;
  aiContext: AIContext;
  portfolio: PortfolioState;
}

export function aiAssistedTrendStrategy(input: StrategyInput): TradeIntent | null {
  const { config, features, aiContext, portfolio } = input;

  if (aiContext.doNotTrade) return null;
  if (features.spreadBps > 15) return null;
  if (features.volatilityPercentile > 80) return null;

  const existingPosition = portfolio.positions.find((position) => position.productId === features.productId);
  const isTrendPositive = features.smaFast > features.smaSlow && features.momentumPct > 0;
  const isTrendNegative = features.smaFast < features.smaSlow && features.momentumPct < -0.5;

  if (isTrendPositive && !existingPosition) {
    return {
      id: randomUUID(),
      productId: features.productId,
      side: "BUY",
      quoteSizeUsd: config.risk.maxTradeNotionalUsd,
      confidence: Math.min(0.7, 0.4 + aiContext.confidence / 2),
      reasonCode: "trend_pullback_confirmed",
      rationale: "Fast trend is above slow trend, momentum is positive, and AI context did not block trading.",
      createdAt: new Date()
    };
  }

  if (isTrendNegative && existingPosition && existingPosition.notionalUsd > 0) {
    return {
      id: randomUUID(),
      productId: features.productId,
      side: "SELL",
      quoteSizeUsd: Math.min(existingPosition.notionalUsd, config.risk.maxTradeNotionalUsd),
      confidence: 0.65,
      reasonCode: "trend_reversal_reduce",
      rationale: "Fast trend is below slow trend and momentum has turned negative, so reduce existing exposure.",
      createdAt: new Date()
    };
  }

  return null;
}
