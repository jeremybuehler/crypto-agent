import "dotenv/config";
import pino from "pino";
import { z } from "zod";

export const TradingModeSchema = z.enum(["paper", "sandbox", "live"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === "true");

const numberFromEnv = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Expected numeric value, got ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
  TRADING_MODE: TradingModeSchema.default("paper"),
  ENABLED_PRODUCTS: z.string().default("BTC-USD,ETH-USD"),
  BASE_CURRENCY: z.string().default("USD"),
  MAX_TRADE_NOTIONAL_USD: numberFromEnv.default("25"),
  MAX_PRODUCT_EXPOSURE_PCT: numberFromEnv.default("10"),
  MAX_TOTAL_EXPOSURE_PCT: numberFromEnv.default("20"),
  MAX_DAILY_LOSS_PCT: numberFromEnv.default("1"),
  MIN_SECONDS_BETWEEN_TRADES: numberFromEnv.default("1800"),
  ALLOW_SHORTS: booleanFromEnv.default("false"),
  ALLOW_LEVERAGE: booleanFromEnv.default("false"),
  REQUIRE_ORDER_PREVIEW: booleanFromEnv.default("true"),
  LIVE_TRADING_ACK: booleanFromEnv.default("false"),
  COINBASE_API_KEY_NAME: z.string().optional(),
  COINBASE_API_PRIVATE_KEY: z.string().optional(),
  COINBASE_REST_BASE_URL: z.string().url().default("https://api.coinbase.com/api/v3/brokerage"),
  COINBASE_SANDBOX_REST_BASE_URL: z.string().url().default("https://api-sandbox.coinbase.com/api/v3/brokerage"),
  USE_SAMPLE_MARKET_DATA: booleanFromEnv.default("false"),
  PERSISTENCE_ENABLED: booleanFromEnv.default("true"),
  DATABASE_URL: z.string().url().optional(),
  PORT: numberFromEnv.default("3000")
});

export type AgentConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const enabledProducts = parsed.ENABLED_PRODUCTS.split(",").map((product) => product.trim()).filter(Boolean);

  if (parsed.TRADING_MODE === "live") {
    const missing: string[] = [];
    if (!parsed.LIVE_TRADING_ACK) missing.push("LIVE_TRADING_ACK=true");
    if (!parsed.COINBASE_API_KEY_NAME) missing.push("COINBASE_API_KEY_NAME");
    if (!parsed.COINBASE_API_PRIVATE_KEY) missing.push("COINBASE_API_PRIVATE_KEY");
    if (parsed.MAX_TRADE_NOTIONAL_USD > 25) missing.push("MAX_TRADE_NOTIONAL_USD<=25 for first live rollout");
    if (missing.length > 0) {
      throw new Error(`Refusing to start live trading. Missing or unsafe settings: ${missing.join(", ")}`);
    }
  }

  if (parsed.PERSISTENCE_ENABLED && !parsed.DATABASE_URL) {
    throw new Error("PERSISTENCE_ENABLED=true requires DATABASE_URL.");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    tradingMode: parsed.TRADING_MODE,
    enabledProducts,
    baseCurrency: parsed.BASE_CURRENCY,
    risk: {
      maxTradeNotionalUsd: parsed.MAX_TRADE_NOTIONAL_USD,
      maxProductExposurePct: parsed.MAX_PRODUCT_EXPOSURE_PCT,
      maxTotalExposurePct: parsed.MAX_TOTAL_EXPOSURE_PCT,
      maxDailyLossPct: parsed.MAX_DAILY_LOSS_PCT,
      minSecondsBetweenTrades: parsed.MIN_SECONDS_BETWEEN_TRADES,
      allowShorts: parsed.ALLOW_SHORTS,
      allowLeverage: parsed.ALLOW_LEVERAGE,
      requireOrderPreview: parsed.REQUIRE_ORDER_PREVIEW
    },
    coinbase: {
      apiKeyName: parsed.COINBASE_API_KEY_NAME,
      apiPrivateKey: parsed.COINBASE_API_PRIVATE_KEY,
      restBaseUrl: parsed.TRADING_MODE === "sandbox" ? parsed.COINBASE_SANDBOX_REST_BASE_URL : parsed.COINBASE_REST_BASE_URL,
      useSampleMarketData: parsed.USE_SAMPLE_MARKET_DATA
    },
    persistence: {
      enabled: parsed.PERSISTENCE_ENABLED,
      databaseUrl: parsed.DATABASE_URL
    },
    port: parsed.PORT
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["coinbase.apiPrivateKey", "authorization", "headers.authorization"]
});

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
  createdAt: Date;
}

export interface RiskDecision {
  approved: boolean;
  intent: TradeIntent;
  checkedAt: Date;
  reasons: string[];
  ruleResults: Array<{ rule: string; passed: boolean; message: string }>;
}
