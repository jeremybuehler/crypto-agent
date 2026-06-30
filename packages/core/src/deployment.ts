/**
 * Machine-checkable live-trading preflight. It only *reads* the provided state
 * and reports pass/fail per check — it can neither set the operator's
 * acknowledgement nor bypass a failed check. Going live requires every check to
 * pass; a single failure makes the whole report not-ok (fail closed).
 */

export interface LivePreflightInput {
  tradingMode: string;
  liveTradingAck: boolean;
  maxTradeNotionalUsd: number;
  bootstrapNotionalCeilingUsd: number;
  hasCoinbaseKey: boolean;
  hasCoinbasePrivateKey: boolean;
  operatorToken: string | undefined;
  internalToken: string | undefined;
  persistenceEnabled: boolean;
  hasDatabaseUrl: boolean;
  hasRedisUrl: boolean;
  alertsConfigured: boolean;
  reconciliationOk: boolean;
}

export interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  checks: PreflightCheck[];
}

const MIN_TOKEN_LENGTH = 32;

export function evaluateLivePreflight(input: LivePreflightInput): PreflightReport {
  const checks: PreflightCheck[] = [];
  const check = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

  check("trading_mode_is_live", input.tradingMode === "live", `TRADING_MODE=${input.tradingMode}`);
  // The acknowledgement is an input from the environment; this code never sets it.
  check("live_ack_present", input.liveTradingAck === true, "LIVE_TRADING_ACK must be true");
  check(
    "notional_within_ceiling",
    input.maxTradeNotionalUsd > 0 && input.maxTradeNotionalUsd <= input.bootstrapNotionalCeilingUsd,
    `MAX_TRADE_NOTIONAL_USD=${input.maxTradeNotionalUsd} must be in (0, ${input.bootstrapNotionalCeilingUsd}]`
  );
  check("coinbase_credentials_present", input.hasCoinbaseKey && input.hasCoinbasePrivateKey, "Coinbase API key + private key required");

  const tokensPresent = !!input.operatorToken && !!input.internalToken;
  const tokensStrong =
    (input.operatorToken?.length ?? 0) >= MIN_TOKEN_LENGTH && (input.internalToken?.length ?? 0) >= MIN_TOKEN_LENGTH;
  const tokensDistinct = input.operatorToken !== input.internalToken;
  check("api_tokens_strong_and_distinct", tokensPresent && tokensStrong && tokensDistinct, "operator/internal tokens must be present, >=32 chars, and distinct");

  check("durable_state_configured", input.persistenceEnabled && input.hasDatabaseUrl, "PERSISTENCE_ENABLED + DATABASE_URL required");
  check("redis_configured", input.hasRedisUrl, "REDIS_URL required for durable ops state");
  check("alerts_configured", input.alertsConfigured, "an alert webhook must be configured");
  check("reconciliation_passed", input.reconciliationOk, "a read-only reconciliation must pass with no drift");

  return { ok: checks.every((c) => c.passed), checks };
}
