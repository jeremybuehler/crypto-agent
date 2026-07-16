import { randomUUID } from "node:crypto";
import { ClaudeAIContextProvider, ConservativeStubAIContextProvider, type AIContextProvider } from "@agent/ai";
import {
  CoinbaseOrderClient,
  CoinbasePublicMarketData,
  CoinbaseRestClient,
  type CoinbaseFill
} from "@agent/coinbase";
import {
  AlertDispatcher,
  StdoutAlertSink,
  WebhookAlertSink,
  loadConfig,
  logger,
  type Alert,
  type AlertSink,
  type MarketSnapshot,
  type PortfolioState,
  type ProductId,
  type RiskDecision,
  type TradeIntent
} from "@agent/core";
import { PaperBroker, computeProposalDigest, previewOrder, type OrderPreview } from "@agent/execution";
import { computeFeatures, type Candle } from "@agent/market-data";
import {
  createOperatorRepositoryForConfig,
  createPersistenceRepository,
  type ClaimedProposal,
  type OperatorRepository
} from "@agent/persistence";
import { evaluateRisk } from "@agent/risk";
import { createStrategy, runStrategy } from "@agent/strategy";

const config = loadConfig();
const persistence = createPersistenceRepository(config.persistence);

// Non-paper modes execute approved proposals against the real Coinbase API, so
// the worker owns an operator repository (to claim/mark proposals) and a signed
// order client. Both are null in paper mode (no real execution surface).
const operatorRepo: OperatorRepository | null =
  config.tradingMode === "paper" ? null : createOperatorRepositoryForConfig(config.persistence);
const restClient = config.tradingMode === "paper" ? null : new CoinbaseRestClient(config.coinbase);
const orderClient = restClient ? new CoinbaseOrderClient((options) => restClient.request(options)) : null;

const alertSinks: AlertSink[] = [new StdoutAlertSink()];
if (process.env.ALERT_WEBHOOK_URL) {
  alertSinks.push(
    new WebhookAlertSink({
      url: process.env.ALERT_WEBHOOK_URL,
      ...(process.env.ALERT_WEBHOOK_TOKEN ? { token: process.env.ALERT_WEBHOOK_TOKEN } : {})
    })
  );
}
const alerts = new AlertDispatcher(alertSinks, (error, alert) =>
  logger.error({ error, alertId: alert.id }, "Alert sink failed.")
);

// Latched circuit breaker. Once tripped (daily loss halt, reconciliation
// breach) the worker refuses to generate intents or drain approvals until the
// operator restarts the process — a deliberate manual step, mirroring the
// live-mode kill switch that only the operator can clear.
let circuitBreakerReason: string | null = null;

export function tripCircuitBreaker(reason: string): void {
  circuitBreakerReason = reason;
}

export function circuitBreakerTripped(): string | null {
  return circuitBreakerReason;
}

/** Test seam: production code must never clear the breaker — restart instead. */
export function resetCircuitBreakerForTests(): void {
  circuitBreakerReason = null;
}

// Bounds per loop tick so a backlog or a slow exchange can't monopolize a tick.
const MAX_EXECUTIONS_PER_TICK = 5;
const FILL_CONFIRM_ATTEMPTS = 5;
const FILL_CONFIRM_DELAY_MS = 500;

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const HEARTBEAT_TIMEOUT_MS = 5_000;
const HEARTBEAT_MAX_ATTEMPTS = 3;
let heartbeatVersion = 0;

const initialPortfolio: PortfolioState = {
  equityUsd: 1_000,
  cashUsd: 1_000,
  dailyPnlPct: 0,
  totalExposurePct: 0,
  positions: []
};

// Trade spacing (MIN_SECONDS_BETWEEN_TRADES) is governed here; the loop
// interval is only the sampling cadence. Two separate clocks on purpose:
// lastFillAt is real executions only and feeds the risk cooldown, while
// lastProposalAt reserves the proposal slot so identical proposals aren't
// re-posted every tick. Intent generation spaces against BOTH; the
// execution-time re-check spaces against fills only — otherwise a proposal
// could never be approved inside the cooldown window it started itself.
let lastFillAt: Date | undefined;
let lastProposalAt: Date | undefined;

function latestTradeMarker(): Date | undefined {
  if (lastFillAt && lastProposalAt) return lastFillAt > lastProposalAt ? lastFillAt : lastProposalAt;
  return lastFillAt ?? lastProposalAt;
}

/**
 * Run one trading loop, then report a heartbeat with the resulting portfolio.
 * The heartbeat is the worker's durable liveness + portfolio signal; a loop
 * failure still reports a `degraded` heartbeat before rethrowing.
 */
export async function runOnce(portfolio: PortfolioState = initialPortfolio): Promise<PortfolioState> {
  if (circuitBreakerReason) {
    logger.error({ reason: circuitBreakerReason }, "Circuit breaker tripped; refusing to trade until restart.");
    await postHeartbeat(portfolio, "degraded");
    return portfolio;
  }
  try {
    // Drain operator-approved proposals into real fills BEFORE generating new
    // intents, so risk/exposure downstream reflects what we just executed.
    const afterExecution = await executeApprovedProposals(portfolio);
    const result = await runTradingLoop(afterExecution);
    await postHeartbeat(result, "ok");
    return result;
  } catch (error) {
    await postHeartbeat(portfolio, "degraded");
    throw error;
  }
}

export function dailyLossRuleFailed(decision: RiskDecision): boolean {
  return decision.ruleResults.some((result) => result.rule === "daily_loss" && !result.passed);
}

/** Id is the UTC day, so a breach pages once and repeat rejections stay quiet. */
export function buildDailyLossHaltAlert(portfolio: PortfolioState, maxDailyLossPct: number, at: Date): Alert {
  return {
    id: `daily_loss_halt:${at.toISOString().slice(0, 10)}`,
    kind: "daily_loss_halt",
    severity: "critical",
    summary: `Daily loss halt: daily PnL ${portfolio.dailyPnlPct.toFixed(2)}% breached the -${maxDailyLossPct}% limit. Trading halted until operator restart.`,
    at,
    metadata: { dailyPnlPct: portfolio.dailyPnlPct, maxDailyLossPct }
  };
}

export function buildOrderSubmittedAlert(
  input: {
    proposalId: string;
    productId: string;
    side: "BUY" | "SELL";
    quoteSizeUsd: number;
    mode: "sandbox" | "live";
    exchangeOrderId: string;
  },
  at: Date
): Alert {
  return {
    id: `order_submitted:${input.proposalId}`,
    kind: "order_submitted",
    severity: input.mode === "live" ? "critical" : "warning",
    summary: `${input.mode} order submitted: ${input.side} $${input.quoteSizeUsd} ${input.productId} (proposal ${input.proposalId}).`,
    at,
    metadata: { ...input }
  };
}

/** Alert (deduped per UTC day) and trip the circuit breaker on a daily-loss breach. */
async function haltOnDailyLoss(decision: RiskDecision, portfolio: PortfolioState): Promise<void> {
  if (!dailyLossRuleFailed(decision)) return;
  await alerts.dispatch(buildDailyLossHaltAlert(portfolio, config.risk.maxDailyLossPct, new Date()));
  tripCircuitBreaker(
    `Daily loss limit breached (daily PnL ${portfolio.dailyPnlPct.toFixed(2)}% vs -${config.risk.maxDailyLossPct}% max).`
  );
}

async function runTradingLoop(portfolio: PortfolioState): Promise<PortfolioState> {
  const productId = (config.enabledProducts[0] ?? "BTC-USD") as `${string}-${string}`;
  const { market, candles } = await loadMarketInputs(productId);
  await persistence.saveMarketSnapshot(market);

  const features = computeFeatures(candles, market);
  const aiProvider: AIContextProvider = config.anthropicApiKey
    ? new ClaudeAIContextProvider(config.anthropicApiKey)
    : new ConservativeStubAIContextProvider();
  const aiContextInput = {
    productId: market.productId,
    timeframe: "1m",
    features: {
      momentumPct: features.momentumPct,
      volatilityPercentile: features.volatilityPercentile,
      spreadBps: features.spreadBps
    },
    portfolioState: {
      dailyPnlPct: portfolio.dailyPnlPct,
      totalExposurePct: portfolio.totalExposurePct
    },
    riskPolicy: {
      maxTradeNotionalUsd: config.risk.maxTradeNotionalUsd,
      maxDailyLossPct: config.risk.maxDailyLossPct
    }
  };
  const aiContext = await aiProvider.generateContext(aiContextInput);
  await persistence.saveAIContext({
    productId: market.productId,
    timeframe: "1m",
    input: aiContextInput,
    output: aiContext
  });

  const strategy = createStrategy(config.strategy.name);
  const intent = runStrategy(strategy, { candles, market, portfolio, config, aiContext });
  if (!intent) {
    logger.info({ productId: market.productId, strategy: strategy.name, features, aiContext }, "No trade intent generated.");
    return portfolio;
  }
  await persistence.saveTradeIntent(intent);

  const spacingMarker = latestTradeMarker();
  const decision = evaluateRisk({
    config,
    intent,
    portfolio,
    killSwitchEnabled: false,
    ...(spacingMarker ? { lastTradeAt: spacingMarker } : {})
  });
  await persistence.saveRiskDecision(decision);
  if (!decision.approved) {
    logger.warn({ intent, decision }, "Trade intent rejected by risk engine.");
    await haltOnDailyLoss(decision, portfolio);
    return portfolio;
  }

  // Paper mode without interactive approval is the ONLY auto-fill path — the
  // simulation surface for tests/backtests. Every other combination (paper with
  // approval, sandbox, live) emits a proposal and never auto-fills; sandbox/live
  // orders are then placed only after the operator approves (see
  // executeApprovedProposals). loadConfig fails closed if a non-paper mode has
  // INTERACTIVE_APPROVAL off, so PaperBroker is unreachable for sandbox/live.
  if (config.tradingMode === "paper" && !config.execution.interactiveApproval) {
    const broker = new PaperBroker();
    const result = broker.execute(decision, market, portfolio);
    await persistence.savePaperFill({ tradeIntentId: intent.id, fill: result.fill });
    lastFillAt = result.fill.filledAt;
    logger.info({ intent, decision, fill: result.fill, portfolio: result.portfolio }, "Paper trade executed.");
    return result.portfolio;
  }

  await postProposal(intent, market);
  // Reserve the proposal slot so we don't spam identical proposals every loop.
  // Deliberately NOT lastFillAt: the execution-time risk re-check must measure
  // the cooldown from real fills, or an approved proposal could never execute
  // inside the cooldown window that posting it started.
  lastProposalAt = new Date();
  return portfolio;
}

/**
 * Submit a proposal to the operator API for interactive approval. Authenticated
 * with the internal token and bounded by a timeout; a failure is logged, never
 * swallowed, but does not throw (the loop continues and will re-propose).
 */
async function postProposal(
  intent: import("@agent/core").TradeIntent,
  market: import("@agent/core").MarketSnapshot
): Promise<void> {
  const apiUrl = process.env.AGENT_API_URL;
  const token = config.security.internalApiToken;
  if (!apiUrl || !token) {
    logger.warn("Interactive approval is on but AGENT_API_URL/INTERNAL_API_TOKEN is missing; skipping proposal.");
    return;
  }

  const preview = previewOrder(intent, market);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${apiUrl}/internal/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": token },
      body: JSON.stringify({
        preview,
        tradeIntentId: intent.id,
        ttlSeconds: config.execution.proposalTtlSeconds,
        correlationId: intent.id
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      logger.error({ status: res.status }, "Proposal submission rejected by API.");
      return;
    }
    logger.info({ intent, preview }, "Proposal submitted for operator approval.");
  } catch (error) {
    logger.error({ error }, "Proposal submission failed.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report the worker's latest portfolio + status to the operator API's internal
 * heartbeat route. Authenticated with the internal token, bounded by a timeout,
 * retried with backoff, and a final failure is logged (never swallowed). Fills
 * themselves are persisted directly (audit chain); this only conveys the
 * portfolio snapshot and liveness, which live in no audit-chain table.
 */
export async function postHeartbeat(portfolio: PortfolioState, status: "ok" | "degraded"): Promise<void> {
  const apiUrl = process.env.AGENT_API_URL;
  const token = config.security.internalApiToken;
  if (!apiUrl) return;
  if (!token) {
    logger.warn("AGENT_API_URL is set but INTERNAL_API_TOKEN is not; skipping heartbeat.");
    return;
  }

  heartbeatVersion += 1;
  const payload = JSON.stringify({
    workerId: WORKER_ID,
    mode: config.tradingMode,
    status,
    version: heartbeatVersion,
    correlationId: randomUUID(),
    observedAt: new Date().toISOString(),
    portfolio
  });

  for (let attempt = 1; attempt <= HEARTBEAT_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      const res = await fetch(`${apiUrl}/internal/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-token": token },
        body: payload,
        signal: controller.signal
      });
      if (res.ok) return;
      // 4xx are not retryable (bad token / payload); 5xx are.
      if (res.status < 500) {
        logger.error({ status: res.status }, "Heartbeat rejected by API; not retrying.");
        return;
      }
      throw new Error(`heartbeat HTTP ${res.status}`);
    } catch (error) {
      if (attempt === HEARTBEAT_MAX_ATTEMPTS) {
        logger.error({ error, attempts: attempt }, "Heartbeat failed after retries.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

interface ConfirmedFill {
  productId: string;
  side: "BUY" | "SELL";
  quoteSizeUsd: number;
  price: number;
  baseSize: number;
  feeUsd: number;
  filledAt: Date;
}

/**
 * Execute operator-approved proposals against the real Coinbase API (sandbox or
 * live). Each proposal is atomically claimed (approved -> executing) so it can
 * be executed at most once, re-checked against fresh risk (the risk engine is
 * the final authority at the moment of execution), placed with the proposal id
 * as an idempotent client_order_id, confirmed from the exchange's own fills
 * (never fabricated from the estimate), and recorded as executed. A read-only
 * reconciliation after each fill halts the loop on any divergence. Paper mode
 * has no real execution surface and returns immediately.
 */
async function executeApprovedProposals(portfolio: PortfolioState): Promise<PortfolioState> {
  if (config.tradingMode === "paper" || !orderClient || !operatorRepo) return portfolio;

  let current = portfolio;
  for (let i = 0; i < MAX_EXECUTIONS_PER_TICK; i++) {
    const claimed = await operatorRepo.claimNextApprovedProposal(new Date());
    if (!claimed) break;

    // The fill's foreign key requires the originating trade intent.
    if (!claimed.tradeIntentId) {
      await failExecution(claimed.id, "Claimed proposal is missing its trade intent id.");
      continue;
    }
    // Defense in depth: the approved preview must not have drifted.
    if (computeProposalDigest(claimed.preview) !== claimed.digest) {
      await failExecution(claimed.id, "Preview digest mismatch at execution time.");
      continue;
    }

    // Fresh market + risk is the final authority immediately before placing.
    let market: MarketSnapshot;
    try {
      ({ market } = await loadMarketInputs(claimed.preview.productId as ProductId));
    } catch {
      await failExecution(claimed.id, "Market data unavailable at execution time.");
      continue;
    }
    const decision = evaluateRisk({
      config,
      intent: previewToIntent(claimed),
      portfolio: current,
      killSwitchEnabled: false,
      ...(lastFillAt ? { lastTradeAt: lastFillAt } : {})
    });
    if (!decision.approved) {
      await failExecution(claimed.id, `Risk rejected at execution: ${decision.reasons.join("; ")}`);
      await haltOnDailyLoss(decision, current);
      if (circuitBreakerReason) break;
      continue;
    }
    void market;

    // Place the order. From here on, an error is IN DOUBT — the order may have
    // landed — so we never auto-retry: leave the proposal `executing`, alert,
    // and stop the drain. client_order_id idempotency makes a later, deliberate
    // re-drive safe.
    let orderId: string;
    try {
      const created = await orderClient.createOrder({
        clientOrderId: claimed.id,
        productId: claimed.preview.productId,
        side: claimed.preview.side,
        quoteSizeUsd: claimed.preview.quoteSizeUsd,
        baseSize: claimed.preview.baseSize
      });
      orderId = created.orderId;
    } catch (error) {
      await alertInDoubt(claimed.id, "Order placement failed; outcome unknown.");
      logger.error({ proposalId: claimed.id, error }, "Order placement in doubt; proposal left executing.");
      break;
    }

    // Page immediately on submission (PRD M8: alert < 10s), before fill
    // confirmation — the operator should hear about a placed order even if
    // confirmation stalls.
    await alerts.dispatch(
      buildOrderSubmittedAlert(
        {
          proposalId: claimed.id,
          productId: claimed.preview.productId,
          side: claimed.preview.side,
          quoteSizeUsd: claimed.preview.quoteSizeUsd,
          mode: config.tradingMode === "live" ? "live" : "sandbox",
          exchangeOrderId: orderId
        },
        new Date()
      )
    );

    // Live confirms from the exchange's own fills (never fabricated). The Coinbase
    // sandbox returns a static, canned fills list that ignores the order_id filter
    // (verified against the live sandbox), so a sandbox order can never be matched
    // to a fill — we record the approved preview's economics instead so the full
    // propose -> approve -> execute lifecycle is observable. Sandbox-only.
    const fill =
      config.tradingMode === "sandbox" ? sandboxFillFromPreview(claimed.preview) : await confirmFill(orderId);
    if (!fill) {
      await alertInDoubt(claimed.id, "Order placed but no fill confirmable; outcome unknown.");
      logger.error({ proposalId: claimed.id, orderId }, "Fill not confirmable; proposal left executing.");
      break;
    }

    await operatorRepo.markProposalExecuted({
      proposalId: claimed.id,
      fill: {
        fillId: randomUUID(),
        tradeIntentId: claimed.tradeIntentId,
        proposalId: claimed.id,
        productId: fill.productId,
        side: fill.side,
        quoteSizeUsd: fill.quoteSizeUsd,
        price: fill.price,
        baseSize: fill.baseSize,
        feeUsd: fill.feeUsd,
        filledAt: fill.filledAt,
        mode: config.tradingMode === "live" ? "live" : "sandbox",
        exchangeOrderId: orderId,
        clientOrderId: claimed.id
      },
      auditId: randomUUID(),
      correlationId: claimed.id,
      now: new Date()
    });
    lastFillAt = fill.filledAt;
    current = applyFillToPortfolio(current, fill);
    logger.info({ proposalId: claimed.id, orderId, fill }, `${config.tradingMode} order executed.`);

    // Read-only cross-check against the exchange; a divergence trips the
    // circuit breaker so the halt survives past this tick (until restart).
    if (await reconciliationBreached()) {
      tripCircuitBreaker("Reconciliation breach: untracked open order(s) on the exchange.");
      break;
    }
  }

  return current;
}

/** Build a minimal intent for the execution-time risk re-check from the approved preview. */
function previewToIntent(claimed: ClaimedProposal): TradeIntent {
  return {
    id: claimed.tradeIntentId ?? claimed.id,
    productId: claimed.preview.productId as ProductId,
    side: claimed.preview.side,
    quoteSizeUsd: claimed.preview.quoteSizeUsd,
    confidence: 1,
    reasonCode: "operator_approved",
    rationale: "Operator-approved proposal executing against the exchange.",
    strategyVersion: "",
    createdAt: claimed.createdAt
  };
}

/**
 * Confirm an order's fills from the exchange with bounded retry (IOC fills can
 * lag the create response). Returns null if still unconfirmable — the caller
 * treats that as in-doubt and never fabricates a fill from the estimate.
 */
async function confirmFill(orderId: string): Promise<ConfirmedFill | null> {
  if (!orderClient) return null;
  for (let attempt = 1; attempt <= FILL_CONFIRM_ATTEMPTS; attempt++) {
    let fills: CoinbaseFill[];
    try {
      fills = await orderClient.getFills(orderId);
    } catch {
      fills = [];
    }
    if (fills.length > 0) return aggregateFills(fills);
    await sleep(FILL_CONFIRM_DELAY_MS * attempt);
  }
  return null;
}

/**
 * Sandbox-only fill synthesis from the approved preview. Coinbase's Advanced
 * Trade sandbox uses fake money and returns mocked, static order/fill data that
 * cannot be reconciled against what we placed, so there is no real exchange fill
 * to confirm. We record the preview's own economics (price, size, fee) as the
 * fill so the operator can observe a complete sandbox execution. This is NEVER
 * used for live: the live path goes through confirmFill and requires real fills.
 */
function sandboxFillFromPreview(preview: OrderPreview): ConfirmedFill {
  const price = preview.limitPrice ?? (preview.baseSize > 0 ? preview.quoteSizeUsd / preview.baseSize : 0);
  return {
    productId: preview.productId,
    side: preview.side,
    quoteSizeUsd: preview.quoteSizeUsd,
    price,
    baseSize: preview.baseSize,
    feeUsd: preview.estimatedFeeUsd,
    filledAt: new Date()
  };
}

/** Aggregate an order's (possibly partial) fills into one executed position. */
function aggregateFills(fills: CoinbaseFill[]): ConfirmedFill {
  let baseSize = 0;
  let quoteSizeUsd = 0;
  let feeUsd = 0;
  let latest = 0;
  for (const fill of fills) {
    baseSize += fill.size;
    quoteSizeUsd += fill.price * fill.size;
    feeUsd += fill.commission;
    const time = fill.trade_time ? Date.parse(fill.trade_time) : Number.NaN;
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  const first = fills[0]!;
  return {
    productId: first.product_id,
    side: first.side,
    quoteSizeUsd,
    price: baseSize > 0 ? quoteSizeUsd / baseSize : 0,
    baseSize,
    feeUsd,
    filledAt: latest > 0 ? new Date(latest) : new Date()
  };
}

/** Apply a real fill to the in-memory portfolio, mirroring PaperBroker accounting. */
function applyFillToPortfolio(portfolio: PortfolioState, fill: ConfirmedFill): PortfolioState {
  const signedBaseSize = fill.side === "BUY" ? fill.baseSize : -fill.baseSize;
  const signedNotional = fill.side === "BUY" ? fill.quoteSizeUsd : -fill.quoteSizeUsd;
  const existing = portfolio.positions.find((position) => position.productId === fill.productId);
  const positions = portfolio.positions.filter((position) => position.productId !== fill.productId);
  const updatedBaseSize = (existing?.baseSize ?? 0) + signedBaseSize;
  const updatedNotional = Math.max(0, (existing?.notionalUsd ?? 0) + signedNotional);
  if (updatedBaseSize > 0.00000001 && updatedNotional > 0) {
    positions.push({
      productId: fill.productId as ProductId,
      baseSize: updatedBaseSize,
      notionalUsd: updatedNotional,
      exposurePct: (updatedNotional / portfolio.equityUsd) * 100,
      averageEntryPrice: existing?.averageEntryPrice ?? fill.price
    });
  }
  return {
    ...portfolio,
    cashUsd: portfolio.cashUsd - signedNotional - fill.feeUsd,
    totalExposurePct: positions.reduce((sum, position) => sum + position.exposurePct, 0),
    positions
  };
}

/**
 * Read-only reconciliation: our IOC market orders never rest, so the exchange
 * reporting ANY open order we don't track means we may be trading blind — a
 * breach. On breach we alert and halt the loop; the operator engages the kill
 * switch via the API. (Per-position reconciliation against account balances is
 * deferred — sandbox seed balances make it too noisy without a real ledger.)
 */
async function reconciliationBreached(): Promise<boolean> {
  if (!orderClient) return false;
  // The Coinbase sandbox returns a canned open-orders list (a standing mock
  // order it never lets us cancel), so the untracked-open-order breach check is
  // a live-only control — in sandbox it would false-trip on every tick. Sandbox
  // uses fake money and mocked responses; skip it, consistent with the deferred
  // per-position reconciliation noted below.
  if (config.tradingMode === "sandbox") return false;
  try {
    const openOrders = await orderClient.listOpenOrders();
    const untracked = openOrders.map((order) => order.order_id);
    if (untracked.length === 0) return false;
    await alerts.dispatch({
      id: `reconciliation:${untracked.sort().join(",")}`,
      kind: "reconciliation_drift",
      severity: "critical",
      summary: `Reconciliation breach: ${untracked.length} untracked open order(s) on the exchange. Halting.`,
      at: new Date(),
      metadata: { untrackedOrderCount: untracked.length }
    });
    logger.error({ untrackedOrderCount: untracked.length }, "Reconciliation breach; halting loop.");
    return true;
  } catch (error) {
    // A reconciliation we cannot complete is itself unsafe to trade through.
    await alerts.dispatch({
      id: `reconciliation-error:${Date.now()}`,
      kind: "reconciliation_error",
      severity: "warning",
      summary: "Reconciliation check failed; halting the loop as a precaution.",
      at: new Date()
    });
    logger.error({ error }, "Reconciliation check failed; halting loop.");
    return true;
  }
}

async function failExecution(proposalId: string, reason: string): Promise<void> {
  if (operatorRepo) {
    await operatorRepo.markProposalExecutionFailed({
      proposalId,
      reason,
      auditId: randomUUID(),
      correlationId: proposalId,
      now: new Date()
    });
  }
  await alerts.dispatch({
    id: `exec-failed:${proposalId}`,
    kind: "execution_failed",
    severity: "warning",
    summary: `Execution failed for proposal ${proposalId}: ${reason}`,
    at: new Date()
  });
  logger.warn({ proposalId, reason }, "Proposal execution failed.");
}

async function alertInDoubt(proposalId: string, summary: string): Promise<void> {
  // Never surface raw exchange payloads; the proposal stays `executing` for
  // reconciliation or the operator to resolve.
  await alerts.dispatch({
    id: `exec-indoubt:${proposalId}`,
    kind: "execution_in_doubt",
    severity: "critical",
    summary: `${summary} Proposal ${proposalId} left executing for reconciliation.`,
    at: new Date()
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMarketInputs(productId: `${string}-${string}`): Promise<{ market: MarketSnapshot; candles: Candle[] }> {
  if (config.coinbase.useSampleMarketData) {
    return sampleMarketInputs(productId);
  }

  const marketData = new CoinbasePublicMarketData(config.coinbase);

  try {
    const [market, candles] = await Promise.all([
      marketData.getBestBidAsk(productId),
      marketData.getCandles({ productId, granularity: "ONE_MINUTE", limit: 100 })
    ]);

    if (candles.length < 5) {
      throw new Error(`Expected at least 5 candles, received ${candles.length}.`);
    }

    return { market, candles };
  } catch (error) {
    logger.warn({ error, productId }, "Falling back to sample market data after Coinbase public market-data failure.");
    return sampleMarketInputs(productId);
  }
}

const SAMPLE_CANDLES = 60;
const SAMPLE_PERIOD = 20; // candles per oscillation cycle

function sampleMarketInputs(productId: `${string}-${string}`): { market: MarketSnapshot; candles: Candle[] } {
  // A smooth sine oscillation gives the real strategies enough history (>=26
  // bars) with genuine uptrends, reversals, and range breaks. The phase drifts
  // continuously with wall-clock time (NOT floored per minute) so the live price
  // moves on every tick — otherwise consecutive ticks in the same minute are
  // identical and the dashboard chart renders every candle as a flat dash.
  const nowMs = Date.now();
  const phase = nowMs / 60_000;
  const closes = Array.from({ length: SAMPLE_CANDLES }, (_, i) =>
    100 * (1 + 0.05 * Math.sin(((phase + i) * 2 * Math.PI) / SAMPLE_PERIOD))
  );

  const candles: Candle[] = closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!;
    return {
      productId,
      start: new Date(nowMs - (SAMPLE_CANDLES - i) * 60_000),
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 10 + (i % 5)
    };
  });

  // Live price = current trend value plus a small fast wiggle. The wiggle's 13s
  // period doesn't align with the loop interval, so every snapshot within a
  // ~20s chart bucket differs — giving each candle a real body and wicks instead
  // of a flat line. Amplitude (~0.4%) stays well under the 5% trend swing.
  const trend = closes[closes.length - 1]!;
  const price = trend * (1 + 0.004 * Math.sin((nowMs / 13_000) * 2 * Math.PI));
  const market: MarketSnapshot = {
    productId,
    price,
    bid: price * 0.9995,
    ask: price * 1.0005,
    spreadBps: 10,
    timestamp: new Date()
  };

  return { market, candles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // `--once` forces a single run even when WORKER_LOOP_MS is configured.
  const loopMs = process.argv.includes("--once") ? 0 : Number(process.env.WORKER_LOOP_MS ?? "0");
  try {
    await persistence.migrate();
    if (loopMs > 0) {
      // Continuous mode: carry portfolio state across iterations so equity,
      // positions, and realized PnL evolve. Ctrl-C / SIGTERM to stop.
      let portfolio = initialPortfolio;
      let running = true;
      process.on("SIGINT", () => (running = false));
      process.on("SIGTERM", () => (running = false));
      logger.info({ loopMs }, "Worker loop started.");
      while (running) {
        try {
          portfolio = await runOnce(portfolio);
        } catch (error) {
          logger.error({ error }, "Loop iteration failed; continuing.");
        }
        await new Promise((resolve) => setTimeout(resolve, loopMs));
      }
    } else {
      await runOnce();
    }
  } catch (error) {
    logger.error({ error }, "Worker failed.");
    process.exitCode = 1;
  } finally {
    await persistence.close();
    if (operatorRepo) await operatorRepo.close();
  }
}
