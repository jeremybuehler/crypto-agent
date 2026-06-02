import type { Clock, MarketSnapshot, PortfolioState, RiskDecision } from "@agent/core";
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
export declare class PaperBroker {
    private readonly feeRate;
    private readonly slippageBps;
    private readonly clock;
    constructor(feeRate?: number, slippageBps?: number, clock?: Clock);
    execute(decision: RiskDecision, market: MarketSnapshot, portfolio: PortfolioState): {
        fill: SimulatedFill;
        portfolio: PortfolioState;
    };
}
