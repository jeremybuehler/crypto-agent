import { describe, expect, it } from "vitest";
import { loadConfig } from "@agent/core";

const validPaperEnv = {
  TRADING_MODE: "paper",
  ENABLED_PRODUCTS: "BTC-USD",
  MAX_TRADE_NOTIONAL_USD: "25",
  MAX_PRODUCT_EXPOSURE_PCT: "10",
  MAX_TOTAL_EXPOSURE_PCT: "20",
  MAX_DAILY_LOSS_PCT: "1",
  MIN_SECONDS_BETWEEN_TRADES: "1800",
  ALLOW_SHORTS: "false",
  ALLOW_LEVERAGE: "false",
  REQUIRE_ORDER_PREVIEW: "true",
  PERSISTENCE_ENABLED: "false"
} as const;

describe("config loader", () => {
  it("loads a valid paper-mode env without errors", () => {
    const config = loadConfig(validPaperEnv);
    expect(config.tradingMode).toBe("paper");
    expect(config.enabledProducts).toEqual(["BTC-USD"]);
    expect(config.risk.maxTradeNotionalUsd).toBe(25);
  });

  it("rejects live mode without LIVE_TRADING_ACK", () => {
    expect(() =>
      loadConfig({
        ...validPaperEnv,
        TRADING_MODE: "live",
        COINBASE_API_KEY_NAME: "key",
        COINBASE_API_PRIVATE_KEY: "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"
      })
    ).toThrow("LIVE_TRADING_ACK=true");
  });

  it("rejects live mode when MAX_TRADE_NOTIONAL_USD exceeds 25", () => {
    expect(() =>
      loadConfig({
        ...validPaperEnv,
        TRADING_MODE: "live",
        LIVE_TRADING_ACK: "true",
        MAX_TRADE_NOTIONAL_USD: "50",
        COINBASE_API_KEY_NAME: "key",
        COINBASE_API_PRIVATE_KEY: "pk"
      })
    ).toThrow("MAX_TRADE_NOTIONAL_USD<=25");
  });

  it("rejects when PERSISTENCE_ENABLED is true but DATABASE_URL is missing", () => {
    expect(() =>
      loadConfig({ ...validPaperEnv, PERSISTENCE_ENABLED: "true" })
    ).toThrow("DATABASE_URL");
  });

  it("parses multiple enabled products from comma-separated string", () => {
    const config = loadConfig({ ...validPaperEnv, ENABLED_PRODUCTS: "BTC-USD, ETH-USD , SOL-USD" });
    expect(config.enabledProducts).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
  });

  it("rejects a non-numeric MAX_TRADE_NOTIONAL_USD", () => {
    expect(() =>
      loadConfig({ ...validPaperEnv, MAX_TRADE_NOTIONAL_USD: "not-a-number" })
    ).toThrow();
  });
});
