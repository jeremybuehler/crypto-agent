import type { MarketSnapshot, ProductId } from "@agent/core";
export interface Candle {
    productId: ProductId;
    start: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface FeatureSnapshot {
    productId: ProductId;
    generatedAt: Date;
    close: number;
    smaFast: number;
    smaSlow: number;
    momentumPct: number;
    volatilityPercentile: number;
    spreadBps: number;
}
export declare function computeFeatures(candles: Candle[], market: MarketSnapshot): FeatureSnapshot;
