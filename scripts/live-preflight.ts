/**
 * Live-trading preflight CLI. Reads the environment and a read-only
 * reconciliation result, then prints every check and exits non-zero unless ALL
 * pass. It cannot set the operator's acknowledgement or skip a failure — those
 * are inputs it merely reports on.
 *
 * RECONCILIATION_OK must be set to "true" by an out-of-band, read-only
 * reconciliation run; the preflight does not fabricate it.
 */
import "dotenv/config";
import { evaluateLivePreflight, type LivePreflightInput } from "@agent/core";

const BOOTSTRAP_NOTIONAL_CEILING_USD = 100;

const input: LivePreflightInput = {
  tradingMode: process.env.TRADING_MODE ?? "paper",
  liveTradingAck: process.env.LIVE_TRADING_ACK === "true",
  maxTradeNotionalUsd: Number(process.env.MAX_TRADE_NOTIONAL_USD ?? "0"),
  bootstrapNotionalCeilingUsd: BOOTSTRAP_NOTIONAL_CEILING_USD,
  hasCoinbaseKey: !!process.env.COINBASE_API_KEY_NAME,
  hasCoinbasePrivateKey: !!process.env.COINBASE_API_PRIVATE_KEY,
  operatorToken: process.env.OPERATOR_API_TOKEN,
  internalToken: process.env.INTERNAL_API_TOKEN,
  persistenceEnabled: process.env.PERSISTENCE_ENABLED === "true",
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  hasRedisUrl: !!process.env.REDIS_URL,
  alertsConfigured: !!process.env.ALERT_WEBHOOK_URL,
  reconciliationOk: process.env.RECONCILIATION_OK === "true"
};

const report = evaluateLivePreflight(input);

for (const check of report.checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name.padEnd(34)} ${check.passed ? "" : "- " + check.detail}`);
}
console.log(report.ok ? "\nPREFLIGHT PASSED — live trading may proceed." : "\nPREFLIGHT FAILED — live trading is blocked.");

process.exit(report.ok ? 0 : 1);
