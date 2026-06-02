import type { AIContext } from "@agent/ai";
import type { AgentConfig, Clock, PortfolioState, TradeIntent } from "@agent/core";
import type { FeatureSnapshot } from "@agent/market-data";
export declare const STRATEGY_VERSION = "ai-assisted-trend-v1";
export interface StrategyInput {
    config: AgentConfig;
    features: FeatureSnapshot;
    aiContext: AIContext;
    portfolio: PortfolioState;
    clock?: Clock;
}
export declare function aiAssistedTrendStrategy(input: StrategyInput): TradeIntent | null;
