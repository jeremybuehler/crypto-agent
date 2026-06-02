import "dotenv/config";
import pino from "pino";
import { z } from "zod";
export declare const TradingModeSchema: z.ZodEnum<["paper", "sandbox", "live"]>;
export type TradingMode = z.infer<typeof TradingModeSchema>;
export type AgentConfig = ReturnType<typeof loadConfig>;
export declare function loadConfig(env?: NodeJS.ProcessEnv): {
    nodeEnv: string;
    logLevel: string;
    tradingMode: "paper" | "sandbox" | "live";
    enabledProducts: string[];
    baseCurrency: string;
    risk: {
        maxTradeNotionalUsd: number;
        maxProductExposurePct: number;
        maxTotalExposurePct: number;
        maxDailyLossPct: number;
        minSecondsBetweenTrades: number;
        allowShorts: boolean;
        allowLeverage: boolean;
        requireOrderPreview: boolean;
    };
    anthropicApiKey: string | undefined;
    redisUrl: string | undefined;
    coinbase: {
        apiKeyName: string | undefined;
        apiPrivateKey: string | undefined;
        restBaseUrl: string;
        useSampleMarketData: boolean;
    };
    persistence: {
        enabled: boolean;
        databaseUrl: string | undefined;
    };
    port: number;
};
export interface Clock {
    now(): Date;
}
export declare const SystemClock: Clock;
export declare const logger: pino.Logger<never, boolean>;
export type ProductId = `${string}-${string}`;
export type Side = "BUY" | "SELL";
export interface MarketSnapshot {
    productId: ProductId;
    price: number;
    bid: number;
    ask: number;
    spreadBps: number;
    timestamp: Date;
}
export interface PortfolioState {
    equityUsd: number;
    cashUsd: number;
    dailyPnlPct: number;
    totalExposurePct: number;
    positions: Array<{
        productId: ProductId;
        baseSize: number;
        notionalUsd: number;
        exposurePct: number;
        averageEntryPrice: number;
    }>;
}
export interface TradeIntent {
    id: string;
    productId: ProductId;
    side: Side;
    quoteSizeUsd: number;
    confidence: number;
    reasonCode: string;
    rationale: string;
    strategyVersion: string;
    createdAt: Date;
}
export interface RiskDecision {
    approved: boolean;
    intent: TradeIntent;
    checkedAt: Date;
    reasons: string[];
    ruleResults: Array<{
        rule: string;
        passed: boolean;
        message: string;
    }>;
}
