import "dotenv/config";
import pino from "pino";
import { z } from "zod";

export * from "./telemetry.js";
export * from "./alerts.js";
export * from "./deployment.js";

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
  // When true, the worker emits a proposal for operator approval instead of
  // auto-filling. Default false keeps the simulation-only auto-fill for
  // tests/backtests.
  INTERACTIVE_APPROVAL: booleanFromEnv.default("false"),
  PROPOSAL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  LIVE_TRADING_ACK: booleanFromEnv.default("false"),
  ANTHROPIC_API_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  COINBASE_API_KEY_NAME: z.string().optional(),
  COINBASE_API_PRIVATE_KEY: z.string().optional(),
  COINBASE_REST_BASE_URL: z.string().url().default("https://api.coinbase.com/api/v3/brokerage"),
  COINBASE_SANDBOX_REST_BASE_URL: z.string().url().default("https://api-sandbox.coinbase.com/api/v3/brokerage"),
  USE_SAMPLE_MARKET_DATA: booleanFromEnv.default("false"),
  PERSISTENCE_ENABLED: booleanFromEnv.default("true"),
  DATABASE_URL: z.string().url().optional(),
  OPERATOR_API_TOKEN: z.string().optional(),
  INTERNAL_API_TOKEN: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  TRUST_PROXY: booleanFromEnv.default("false"),
  API_BODY_LIMIT_BYTES: numberFromEnv.default("65536"),
  API_RATE_LIMIT_MAX: numberFromEnv.default("120"),
  API_RATE_LIMIT_WINDOW_MS: numberFromEnv.default("60000"),
  PORT: numberFromEnv.default("3000")
});

/** Minimum length (proxy for entropy) required of any configured API token. */
export const MIN_API_TOKEN_LENGTH = 32;

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

  // API security configuration. Fail closed, and never include token values in
  // any error message (docs/SECURITY.md "Trust boundaries and authentication").
  const isProduction = parsed.NODE_ENV === "production";
  const tokenIssues: string[] = [];
  if (isProduction && !parsed.OPERATOR_API_TOKEN) tokenIssues.push("OPERATOR_API_TOKEN is required in production");
  if (isProduction && !parsed.INTERNAL_API_TOKEN) tokenIssues.push("INTERNAL_API_TOKEN is required in production");
  if (parsed.OPERATOR_API_TOKEN && parsed.OPERATOR_API_TOKEN.length < MIN_API_TOKEN_LENGTH) {
    tokenIssues.push(`OPERATOR_API_TOKEN must be at least ${MIN_API_TOKEN_LENGTH} characters`);
  }
  if (parsed.INTERNAL_API_TOKEN && parsed.INTERNAL_API_TOKEN.length < MIN_API_TOKEN_LENGTH) {
    tokenIssues.push(`INTERNAL_API_TOKEN must be at least ${MIN_API_TOKEN_LENGTH} characters`);
  }
  if (
    parsed.OPERATOR_API_TOKEN &&
    parsed.INTERNAL_API_TOKEN &&
    parsed.OPERATOR_API_TOKEN === parsed.INTERNAL_API_TOKEN
  ) {
    tokenIssues.push("OPERATOR_API_TOKEN and INTERNAL_API_TOKEN must be different");
  }
  if (tokenIssues.length > 0) {
    throw new Error(`Invalid API security configuration: ${tokenIssues.join(", ")}`);
  }

  const allowedOrigins = parsed.ALLOWED_ORIGINS
    ? parsed.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

  const config = {
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
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    redisUrl: parsed.REDIS_URL,
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
    execution: {
      interactiveApproval: parsed.INTERACTIVE_APPROVAL,
      proposalTtlSeconds: parsed.PROPOSAL_TTL_SECONDS
    },
    security: {
      operatorApiToken: parsed.OPERATOR_API_TOKEN,
      internalApiToken: parsed.INTERNAL_API_TOKEN,
      allowedOrigins,
      trustProxy: parsed.TRUST_PROXY,
      bodyLimitBytes: parsed.API_BODY_LIMIT_BYTES,
      rateLimitMax: parsed.API_RATE_LIMIT_MAX,
      rateLimitWindowMs: parsed.API_RATE_LIMIT_WINDOW_MS
    },
    port: parsed.PORT
  };
  return deepFreeze(config);
}

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj as object)) {
    if (value && typeof value === "object") deepFreeze(value);
  }
  return obj;
}

export interface Clock {
  now(): Date;
}

export const SystemClock: Clock = { now: () => new Date() };

/** Paths redacted from every structured log line. Shared by the worker logger
 * and the API's Fastify logger so secrets never reach disk or stdout. */
export const LOG_REDACT_PATHS: string[] = [
  "coinbase.apiPrivateKey",
  "authorization",
  "headers.authorization",
  'headers["x-internal-token"]',
  "security.operatorApiToken",
  "security.internalApiToken"
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: LOG_REDACT_PATHS
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
  strategyVersion: string;
  createdAt: Date;
}

export interface RiskDecision {
  approved: boolean;
  intent: TradeIntent;
  checkedAt: Date;
  reasons: string[];
  ruleResults: Array<{ rule: string; passed: boolean; message: string }>;
}
