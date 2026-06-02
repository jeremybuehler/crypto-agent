import "dotenv/config";
import pino from "pino";
import { z } from "zod";
export const TradingModeSchema = z.enum(["paper", "sandbox", "live"]);
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
    ANTHROPIC_API_KEY: z.string().optional(),
    REDIS_URL: z.string().optional(),
    COINBASE_API_KEY_NAME: z.string().optional(),
    COINBASE_API_PRIVATE_KEY: z.string().optional(),
    COINBASE_REST_BASE_URL: z.string().url().default("https://api.coinbase.com/api/v3/brokerage"),
    COINBASE_SANDBOX_REST_BASE_URL: z.string().url().default("https://api-sandbox.coinbase.com/api/v3/brokerage"),
    USE_SAMPLE_MARKET_DATA: booleanFromEnv.default("false"),
    PERSISTENCE_ENABLED: booleanFromEnv.default("true"),
    DATABASE_URL: z.string().url().optional(),
    PORT: numberFromEnv.default("3000")
});
export function loadConfig(env = process.env) {
    const parsed = envSchema.parse(env);
    const enabledProducts = parsed.ENABLED_PRODUCTS.split(",").map((product) => product.trim()).filter(Boolean);
    if (parsed.TRADING_MODE === "live") {
        const missing = [];
        if (!parsed.LIVE_TRADING_ACK)
            missing.push("LIVE_TRADING_ACK=true");
        if (!parsed.COINBASE_API_KEY_NAME)
            missing.push("COINBASE_API_KEY_NAME");
        if (!parsed.COINBASE_API_PRIVATE_KEY)
            missing.push("COINBASE_API_PRIVATE_KEY");
        if (parsed.MAX_TRADE_NOTIONAL_USD > 25)
            missing.push("MAX_TRADE_NOTIONAL_USD<=25 for first live rollout");
        if (missing.length > 0) {
            throw new Error(`Refusing to start live trading. Missing or unsafe settings: ${missing.join(", ")}`);
        }
    }
    if (parsed.PERSISTENCE_ENABLED && !parsed.DATABASE_URL) {
        throw new Error("PERSISTENCE_ENABLED=true requires DATABASE_URL.");
    }
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
        port: parsed.PORT
    };
    return deepFreeze(config);
}
function deepFreeze(obj) {
    Object.freeze(obj);
    for (const value of Object.values(obj)) {
        if (value && typeof value === "object")
            deepFreeze(value);
    }
    return obj;
}
export const SystemClock = { now: () => new Date() };
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["coinbase.apiPrivateKey", "authorization", "headers.authorization"]
});
