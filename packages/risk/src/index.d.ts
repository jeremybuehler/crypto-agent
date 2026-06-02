import type { AgentConfig, PortfolioState, RiskDecision, TradeIntent } from "@agent/core";
export { InMemoryOpsState, RedisOpsState, createOpsState, type OpsState } from "./ops-state.js";
export interface RiskInput {
    config: AgentConfig;
    intent: TradeIntent;
    portfolio: PortfolioState;
    killSwitchEnabled: boolean;
    lastTradeAt?: Date;
}
export declare function evaluateRisk(input: RiskInput): RiskDecision;
