# Technical Specification: Crypto Guy v1 (Interactive Live Execution)

Concrete contracts and interfaces for Crypto Guy. Companion to [crypto-guy-architecture.md](./crypto-guy-architecture.md); when this doc conflicts with the architecture, the architecture wins.

---

## 1. Domain primitives

Use branded types to prevent accidental mixing. Defined in `packages/core/src/types.ts`.

```typescript
type Brand<T, B> = T & { readonly __brand: B };

export type ProductId = Brand<string, 'ProductId'>;          // e.g. "BTC-USD"
export type OrderId = Brand<string, 'OrderId'>;              // Coinbase order_id
export type ClientOrderId = Brand<string, 'ClientOrderId'>;  // our UUID v4
export type QuoteSizeUsd = Brand<number, 'QuoteSizeUsd'>;
export type BaseSize = Brand<string, 'BaseSize'>;            // string for precision
export type Price = Brand<string, 'Price'>;                  // string for precision

export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LIMIT';
export type OrderStatus = 'PENDING' | 'AWAITING_APPROVAL' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type TradingMode = 'paper' | 'sandbox' | 'live';
export type MarketRegime = 'trend' | 'range' | 'high_volatility' | 'illiquid' | 'unknown';
```

## 2. Internal event types

Defined in `packages/core/src/events.ts`. Every event carries a `correlationId` so a full chain is reconstructable.

```typescript
interface BaseEvent {
  eventId: string;        // UUID v4
  correlationId: string;  // shared across one trading-loop iteration
  occurredAt: Date;
}

export type MarketCandleClosed = BaseEvent & {
  type: 'MarketCandleClosed';
  productId: ProductId;
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  open: Price; high: Price; low: Price; close: Price; volume: BaseSize;
};

export type FeaturesComputed = BaseEvent & {
  type: 'FeaturesComputed';
  productId: ProductId;
  features: FeatureSnapshot;
};

export type AIContextGenerated = BaseEvent & {
  type: 'AIContextGenerated';
  productId: ProductId;
  context: AIContext;          // see §6
  promptHash: string;
  modelId: string;
  latencyMs: number;
};

export type TradeIntentCreated = BaseEvent & {
  type: 'TradeIntentCreated';
  intent: TradeIntent;
};

export type RiskDecisionCreated = BaseEvent & {
  type: 'RiskDecisionCreated';
  decision: RiskDecision;
};

export type OperatorApprovalRecorded = BaseEvent & {
  type: 'OperatorApprovalRecorded';
  proposalId: string;
  actor: string;
  decision: 'approved' | 'rejected';
  previewHash: string;
  expiresAt: Date;
};

export type OrderPreviewed = BaseEvent & {
  type: 'OrderPreviewed';
  clientOrderId: ClientOrderId;
  previewResponse: OrderPreviewResponse; // Zod-parsed Coinbase shape, see §8
};

export type OrderSubmitted = BaseEvent & {
  type: 'OrderSubmitted';
  clientOrderId: ClientOrderId;
  orderId: OrderId;
};

export type OrderFilled = BaseEvent & {
  type: 'OrderFilled';
  orderId: OrderId;
  fillSize: BaseSize;
  fillPrice: Price;
};

export type ReconciliationDriftDetected = BaseEvent & {
  type: 'ReconciliationDriftDetected';
  productId: ProductId;
  localValue: string;
  remoteValue: string;
  field: string;
};

export type CircuitBreakerTriggered = BaseEvent & {
  type: 'CircuitBreakerTriggered';
  reason: string;
  triggeredBy: string;
};
```

## 3. Configuration contract

`packages/core/src/config.ts` exports a single `loadConfig()` that returns a frozen, validated config object. The Zod schema enforces:

```typescript
const ConfigSchema = z.object({
  tradingMode: z.enum(['paper', 'sandbox', 'live']).default('paper'),
  enabledProducts: z.array(z.string().regex(/^[A-Z]+-[A-Z]+$/)).min(1),
  baseCurrency: z.string().default('USD'),
  maxTradeNotionalUsd: z.coerce.number().positive(),
  maxProductExposurePct: z.coerce.number().min(0).max(100),
  maxTotalExposurePct: z.coerce.number().min(0).max(100),
  maxDailyLossPct: z.coerce.number().min(0).max(100),
  minSecondsBetweenTrades: z.coerce.number().nonnegative(),
  allowShorts: z.coerce.boolean().default(false),
  allowLeverage: z.coerce.boolean().default(false),
  requireOrderPreview: z.coerce.boolean().default(true),
  liveTradingAck: z.coerce.boolean().default(false),
  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),
  coinbaseApiKeyName: z.string().optional(),
  coinbasePrivateKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
}).refine(
  (c) => c.tradingMode !== 'live' || (c.liveTradingAck && c.coinbaseApiKeyName && c.coinbasePrivateKey),
  { message: 'Live mode requires LIVE_TRADING_ACK=true and Coinbase credentials' }
).refine(
  (c) => c.tradingMode !== 'live' || c.maxTradeNotionalUsd <= 50,
  { message: 'Bootstrap live notional cap is $50. Raise after 30d stable operation.' }
);
```

If validation fails, the app must exit with code 1 and a structured error log.

## 4. Database schema (Drizzle)

`packages/persistence/src/schema.ts`. Tables match architecture doc §"Database model". Key columns:

```typescript
// market_snapshots
{ id, productId, price, bidPrice, askPrice, spreadBps, source: 'rest'|'ws',
  capturedAt, createdAt }

// feature_snapshots
{ id, productId, timeframe, featureJson: jsonb, generatedAt, createdAt }

// ai_contexts
{ id, productId, correlationId, modelId, schemaVersion, promptHash,
  inputSnapshotId, outputJson: jsonb, latencyMs, inputTokens, outputTokens,
  createdAt }

// trade_intents
{ id, correlationId, productId, side, quoteSizeUsd, reasonCode,
  strategyVersion, aiContextId, featureSnapshotId, createdAt }

// risk_decisions
{ id, tradeIntentId, approved: boolean, policyVersion,
  ruleResults: jsonb, reasons: text[], checkedAt }

// order_proposals
{ id, tradeIntentId, riskDecisionId, clientOrderId, intentHash, previewHash,
  previewJson: jsonb, status: 'pending'|'approved'|'rejected'|'expired'|'consumed',
  expiresAt, createdAt, updatedAt }

// operator_approvals
{ id, proposalId, actor, decision: 'approved'|'rejected', reason,
  intentHash, previewHash, decidedAt, consumedAt }

// operator_profiles
{ id, version, status: 'draft'|'active'|'superseded', jurisdiction,
  explicitFacts: jsonb, createdAt, activatedAt }

// learning_items
{ id, kind: 'explicit_fact'|'derived_insight'|'education_progress', key,
  valueJson: jsonb, sourceType, sourceId, evidenceJson: jsonb, confidence,
  scope, reviewStatus: 'accepted'|'pending'|'rejected', retentionUntil,
  createdAt, lastConfirmedAt, deletedAt }

// advice_records
{ id, correlationId, profileVersion, evidenceJson: jsonb,
  assumptions: text[], contrarySignals: text[], recommendationJson: jsonb,
  confidence, modelId, strategyVersion, operatorResponse, outcomeJson: jsonb,
  createdAt, evaluatedAt }

// change_proposals
{ id, kind: 'strategy'|'risk', currentVersion, proposedPatch: jsonb,
  evidenceJson: jsonb, expectedImpact, downsideAnalysis, rollbackCriteria,
  status: 'pending'|'approved'|'rejected'|'applied'|'rolled_back',
  actor, decidedAt, appliedAt, createdAt }

// orders
{ id, clientOrderId, coinbaseOrderId, productId, side, type, status,
  requestedQuoteSize, requestedBaseSize, requestJson: jsonb,
  responseJson: jsonb, riskDecisionId, submittedAt, finalizedAt }

// fills
{ id, orderId, coinbaseFillId, baseSize, price, feeUsd, filledAt }

// positions
{ id, productId, baseSize, averageCostUsd, realizedPnlUsd,
  unrealizedPnlUsd, updatedAt }

// portfolio_snapshots
{ id, cashUsd, availableUsd, totalExposurePct, productExposureJson: jsonb,
  realizedPnlDayUsd, unrealizedPnlUsd, drawdownPct, capturedAt }

// ops_events
{ id, eventType, payload: jsonb, actor, createdAt }

// paper_fills (paper mode only — separate from real fills)
{ id, tradeIntentId, productId, side, quoteSizeUsd, baseSize,
  simulatedPrice, simulatedFeeUsd, simulatedSlippageBps, filledAt }
```

All tables have `id` as `uuid` primary key. All FKs are enforced. All `*At` columns are `timestamptz`.

## 5. Module interfaces

### 5.1 ExchangeClient (`packages/coinbase/src/exchange-client.ts`)

Abstract enough to swap exchanges later, concrete enough to use today.

```typescript
export interface ExchangeClient {
  // Read
  getProduct(productId: ProductId): Promise<ProductMetadata>;
  getProducts(): Promise<ProductMetadata[]>;
  getCandles(args: { productId: ProductId; timeframe: Timeframe; start: Date; end: Date; }): Promise<Candle[]>;
  getMarketTrades(args: { productId: ProductId; limit: number }): Promise<MarketTrade[]>;
  getBestBidAsk(productId: ProductId): Promise<BestBidAsk>;
  getAccounts(): Promise<Account[]>;
  getOrder(orderId: OrderId): Promise<Order>;
  listOrders(args: ListOrdersArgs): Promise<Order[]>;
  listFills(args: ListFillsArgs): Promise<Fill[]>;

  // Write
  previewOrder(req: OrderRequest): Promise<OrderPreviewResponse>;
  createOrder(req: OrderRequest): Promise<CreateOrderResponse>;
  cancelOrders(orderIds: OrderId[]): Promise<CancelOrdersResponse>;
  editOrder(req: EditOrderRequest): Promise<EditOrderResponse>;

  // Streams
  subscribeMarketData(args: SubscribeArgs, onEvent: (e: MarketEvent) => void): Promise<Unsubscribe>;
  subscribeUserOrders(onEvent: (e: UserOrderEvent) => void): Promise<Unsubscribe>;
}
```

Two concrete implementations:
- `CoinbaseRestWsClient` — talks to Coinbase Advanced Trade REST + WS.
- `PaperClient` — implements the same interface against an in-memory simulator and live public market data.

A third (`SandboxClient`) is a thin wrapper around the REST client pointed at `https://api-sandbox.coinbase.com/api/v3/brokerage/`.

### 5.2 FeatureEngine (`packages/market-data/src/features.ts`)

```typescript
export interface FeatureSnapshot {
  productId: ProductId;
  timeframe: Timeframe;
  generatedAt: Date;
  // Trend / momentum
  trend: 'up' | 'down' | 'flat';
  rsi14: number;
  emaFastOverSlow: number;       // ratio
  // Volatility
  realizedVol24h: number;
  volatilityPercentile: number;
  // Liquidity / microstructure
  spreadBps: number;
  topOfBookDepthUsd: number;
  // Returns
  returnPct5m: number;
  returnPct1h: number;
  returnPct24h: number;
  drawdownFrom24hHighPct: number;
}

export function computeFeatures(args: {
  productId: ProductId;
  candles: Candle[];
  bestBidAsk: BestBidAsk;
}): FeatureSnapshot;
```

Pure function. Deterministic. No I/O.

### 5.3 AIContextAgent (`packages/ai/src/context-agent.ts`)

```typescript
const AIContextSchema = z.object({
  marketRegime: z.enum(['trend', 'range', 'high_volatility', 'illiquid', 'unknown']),
  summary: z.string().max(500),
  riskNotes: z.array(z.string()).max(10),
  bullishFactors: z.array(z.string()).max(10),
  bearishFactors: z.array(z.string()).max(10),
  doNotTrade: z.boolean(),
  doNotTradeReasons: z.array(z.string()).max(10),
  confidence: z.number().min(0).max(1),
});
export type AIContext = z.infer<typeof AIContextSchema>;

export interface AIContextAgent {
  generateContext(input: AIContextInput): Promise<AIContext>;
}
```

Implementation rules:
- Input is constructed by a whitelist function that excludes all secrets and account identifiers.
- LLM is called with structured output / JSON mode where supported.
- Response is parsed through `AIContextSchema`. Parse failures return a hardcoded `{ doNotTrade: true, doNotTradeReasons: ['llm_schema_parse_failed'], confidence: 0, ... }`.
- Every call persists a row in `ai_contexts` with prompt hash, latency, and token counts.

### 5.4 StrategyEngine (`packages/strategy/src/strategy-engine.ts`)

```typescript
export interface TradeIntent {
  productId: ProductId;
  side: Side;
  quoteSizeUsd: QuoteSizeUsd;
  reasonCode: string;            // machine-readable, e.g. 'trend_pullback_confirmed'
  strategyVersion: string;
  aiContextId: string;
  featureSnapshotId: string;
}

export type StrategyDecision =
  | { kind: 'enter'; intent: TradeIntent }
  | { kind: 'exit'; intent: TradeIntent; reason: string }
  | { kind: 'hold'; reason: string };

export interface Strategy {
  version: string;
  decide(args: {
    features: FeatureSnapshot;
    aiContext: AIContext;
    portfolio: PortfolioSnapshot;
    riskPolicy: RiskPolicy;
  }): StrategyDecision;
}
```

v1 ships one strategy: `ai-assisted-trend.ts`. Implements the rules in architecture doc §"Deterministic strategy example".

### 5.5 RiskEngine (`packages/risk/src/risk-engine.ts`)

```typescript
export interface RiskDecision {
  approved: boolean;
  policyVersion: string;
  ruleResults: Array<{ rule: string; passed: boolean; detail?: string }>;
  rejectionReasons: string[];
  checkedAt: Date;
}

export interface RiskEngine {
  evaluate(args: {
    intent: TradeIntent;
    portfolio: PortfolioSnapshot;
    policy: RiskPolicy;
    mode: TradingMode;
    killSwitchActive: boolean;
  }): RiskDecision;
}
```

Rules to implement (each is a pure function, independently testable):
- `productAllowlist` — productId ∈ policy.enabledProducts
- `notionalCap` — 0 < quoteSizeUsd ≤ policy.maxTradeNotionalUsd
- `dailyLossGuard` — portfolio.realizedPnlDayPct > -policy.maxDailyLossPct
- `productExposureCap` — projected exposure pct ≤ policy.maxProductExposurePct
- `totalExposureCap` — projected total exposure pct ≤ policy.maxTotalExposurePct
- `cooldown` — secondsSinceLastTrade(productId) ≥ policy.minSecondsBetweenTrades
- `noShorts` — !(side === 'SELL' && positionSize <= 0) unless policy.allowShorts
- `modeGate` — mode matches caller's expected mode
- `killSwitch` — !killSwitchActive

Risk engine returns `approved=true` only when ALL rules pass. Property tests must prove this invariant.

### 5.6 ExecutionService (`packages/execution/src/execution-engine.ts`)

```typescript
export interface ExecutionService {
  executeApproved(args: {
    intent: TradeIntent;
    decision: RiskDecision;
    approval: OperatorApproval | null;
    client: ExchangeClient;
    mode: TradingMode;
  }): Promise<ExecutionResult>;
}

export type ExecutionResult =
  | { kind: 'submitted'; orderId: OrderId; clientOrderId: ClientOrderId }
  | { kind: 'awaiting_operator_approval'; proposalId: string; expiresAt: Date }
  | { kind: 'approval_rejected'; reason: string }
  | { kind: 'preview_rejected'; reason: string }
  | { kind: 'submission_failed'; reason: string; retryable: boolean };
```

Always calls `previewOrder` first when `requireOrderPreview=true`. Stores `clientOrderId` (UUID v4) before submission for idempotency. In live mode, it persists an immutable proposal and stops. A later execution attempt may call `createOrder` only after validating a single-use, unexpired operator approval whose intent and preview hashes exactly match the proposal. Approval is consumed atomically with submission claiming so concurrent workers cannot reuse it. Paper and sandbox modes do not require operator approval.

### 5.7 ApprovalService (`packages/execution/src/approval-service.ts`)

```typescript
export interface OperatorApproval {
  proposalId: string;
  actor: string;
  decision: 'approved' | 'rejected';
  intentHash: string;
  previewHash: string;
  decidedAt: Date;
  expiresAt: Date;
}
```

Approval validation fails closed for missing, expired, reused, rejected, malformed, or hash-mismatched records. Postgres is the source of truth. Approval, claim, and consumption use one transaction with row locking or optimistic concurrency. See [INTERACTION_POLICY.md](./INTERACTION_POLICY.md).

### 5.8 ReconciliationService (`packages/execution/src/reconciliation.ts`)

Runs on a schedule (configurable, default 30s). For each enabled product:
1. Fetch remote open orders, fills since last reconcile, account balances.
2. Compare to local `orders`, `fills`, `positions`.
3. Emit `ReconciliationDriftDetected` for each mismatch.
4. If drift count over rolling window exceeds threshold, trigger circuit breaker.

### 5.9 OpsControlService (`packages/risk/src/ops-control.ts`)

```typescript
export interface OpsControl {
  isKillSwitchActive(): Promise<boolean>;
  activateKillSwitch(actor: string, reason: string): Promise<void>;
  clearKillSwitch(actor: string): Promise<void>;
  isPaused(): Promise<boolean>;
  pause(actor: string): Promise<void>;
  resume(actor: string): Promise<void>;
  getMode(): Promise<TradingMode>;
}
```

State is held in BOTH Redis (fast read on every loop tick) and Postgres (durable, audit). Writes go to both; reads prefer Redis but fall back to Postgres on cache miss.

Kill switch cannot be cleared via API in live mode — must be cleared manually in DB.

## 6. AI context contract

### Input (built by `buildAIContextInput`, whitelist-only)

```typescript
interface AIContextInput {
  productId: ProductId;
  timeframe: Timeframe;
  latestPrice: number;
  features: Pick<FeatureSnapshot,
    'trend' | 'rsi14' | 'volatilityPercentile' | 'spreadBps' |
    'returnPct1h' | 'returnPct24h' | 'drawdownFrom24hHighPct'
  >;
  portfolioState: {
    positionSide: 'flat' | 'long' | 'short';
    exposurePct: number;
    dailyPnlPct: number;
  };
  riskPolicy: {
    maxTradeNotionalUsd: number;
    maxDailyLossPct: number;
    allowNewPositions: boolean;
  };
}
```

### Output: see §5.3 `AIContextSchema`.

## 6.1 Education and learning contracts

```typescript
const OperatorProfileSchema = z.object({
  version: z.number().int().positive(),
  jurisdiction: z.string().min(2).max(100),
  goals: z.array(z.string().max(200)).max(20),
  experienceLevel: z.enum(['new', 'beginner', 'intermediate', 'advanced']),
  timeHorizon: z.string().max(200),
  liquidityNeeds: z.string().max(500),
  financialConstraints: z.array(z.string().max(300)).max(20),
  riskTolerance: z.enum(['very_low', 'low', 'moderate', 'high']),
  taxJurisdiction: z.string().max(100),
  confirmedAt: z.date(),
});

const LearningItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['explicit_fact', 'derived_insight', 'education_progress']),
  key: z.string().min(1).max(100),
  value: z.unknown(),
  source: z.object({ type: z.string(), id: z.string() }),
  evidenceIds: z.array(z.string()).max(100),
  confidence: z.number().min(0).max(1),
  scope: z.enum(['session', 'durable']),
  reviewStatus: z.enum(['accepted', 'pending', 'rejected']),
  retentionUntil: z.date().nullable(),
  createdAt: z.date(),
  lastConfirmedAt: z.date().nullable(),
});
```

Precedence rules are deterministic: current explicit facts override derived insights; rejected or deleted items are excluded; conflicting items trigger operator review; stale items reduce personalization. Derived insights start as `pending` unless an allowlisted low-risk education-progress rule marks them accepted. No learning item can write to strategy, risk, configuration, credentials, or approval tables.

## 6.2 Education and advice contracts

An educational response contains `what`, `how`, `whyItMatters`, `risks`, `example`, `limitations`, and an optional comprehension check. A personalized advice response additionally contains `profileVersion`, `profileFactorsUsed`, `evidence`, `facts`, `estimates`, `assumptions`, `contrarySignals`, `alternatives` including no action, `downsideScenarios`, `invalidationConditions`, `confidence`, and `disclosures`.

Advice generation fails closed to non-personalized education when the active profile is unavailable, internally inconsistent, stale beyond policy, or from an unsupported jurisdiction. Stale market data prohibits current-market advice. Model/schema failure returns deterministic educational fallback or no recommendation, never invented profile facts.

## 6.3 Learned change proposals

Strategy and risk suggestions are immutable `ChangeProposal` records containing the current version, proposed patch, evidence, expected impact, downside analysis, test results, and rollback criteria. Only the authenticated operator can approve them. Approval is specific to the exact proposal hash, single-use, and distinct from order approval. Application uses optimistic concurrency and fails if the current strategy or policy version changed after proposal creation.

## 7. Operator API surface (Fastify)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | DB + Redis + worker heartbeat |
| GET | `/status` | bearer | Mode, kill switch, paused, last loop |
| POST | `/ops/pause` | bearer | Pause new trades |
| POST | `/ops/resume` | bearer | Resume |
| POST | `/ops/kill-switch` | bearer | Activate kill switch |
| POST | `/ops/clear-kill-switch` | bearer | Clear (refused in live mode) |
| POST | `/ops/cancel-open-orders` | bearer | Cancel all open orders for allowed products |
| GET | `/portfolio` | bearer | Current positions, exposure, PnL |
| GET | `/orders?since=…` | bearer | Recent orders |
| GET | `/decisions?since=…` | bearer | Recent intents, risk decisions, AI contexts (joined) |
| GET | `/education/topics` | bearer | Recommended topics and education progress |
| POST | `/education/explain` | bearer | Explain a concept or current proposal at the operator's level |
| GET | `/profile` | bearer | Active profile, pending insights, sources, confidence, and retention |
| PATCH | `/profile` | bearer | Correct explicit profile facts and create a new version |
| POST | `/profile/insights/:id/accept` | bearer | Accept a derived insight |
| POST | `/profile/insights/:id/reject` | bearer | Reject a derived insight |
| POST | `/profile/export` | bearer | Export profile and learning data |
| DELETE | `/profile/items/:id` | bearer | Delete a learning item subject to minimal audit tombstone policy |
| GET | `/advice/:id` | bearer | Advice, provenance, profile version, and later outcome |
| GET | `/change-proposals` | bearer | Pending and historical strategy/risk change proposals |
| POST | `/change-proposals/:id/approve` | bearer | Approve one exact learned change proposal |
| POST | `/change-proposals/:id/reject` | bearer | Reject a learned change proposal |
| GET | `/proposals?status=pending` | bearer | Review pending live proposals and their expiry |
| POST | `/proposals/:id/approve` | bearer | Approve one exact, current preview |
| POST | `/proposals/:id/reject` | bearer | Reject a proposal with optional reason |
| POST | `/backtests` | bearer | Start backtest job |
| GET | `/backtests/:id` | bearer | Backtest status + results |

Bearer token comes from `OPERATOR_API_TOKEN` env var. Single static token for solo operator. Rotate manually.

## 7.1 Dashboard UI/UX contract

The local dashboard uses shared tokens and reusable primitives for typography, spacing, color, focus, motion, data visualization, feedback, and layout. Core views cover overview, portfolio, market context, education, profile/memory, advice, trade proposals, strategy/risk change proposals, audit history, and safety operations.

Required behavior:

- Persistently show trading mode, kill-switch/pause state, connectivity, and data freshness.
- Implement loading, empty, fresh, stale, degraded, error, retrying, disabled, and read-only states for every data surface.
- Use progressive disclosure: lead with the decision and material risks; allow evidence, methodology, education, and audit details to expand in place.
- Never rely on color alone. Meet WCAG 2.2 AA targets, preserve visible focus, support keyboard-only workflows, semantic landmarks, screen-reader names, reduced motion, and 200% text zoom.
- Render responsive desktop and tablet layouts without hiding safety controls or material proposal details.
- Show exact proposal parameters, fees, slippage, expiry, confidence, risk results, downside, and changes since the prior preview before approval.
- Keep approve/reject and destructive safety actions visually distinct. Confirm consequential actions with plain-language impact, not dark patterns.
- Sanitize rendered external/LLM content and prohibit arbitrary HTML or script execution.

Performance targets under the supported deployment profile are LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1. Automated accessibility checks, component-state tests, responsive screenshots, visual regression, and browser end-to-end tests are release gates for critical workflows.

## 8. Coinbase integration specifics

### 8.1 JWT generation (`packages/coinbase/src/auth.ts`)

- Algorithm: ES256
- TTL: 120 seconds, generated fresh per REST request, per WS connection
- Header includes `kid` = API key name
- Payload includes `iss: 'cdp'`, `nbf: now`, `exp: now + 120`, `sub: keyName`, `uri: METHOD host/path` (no query string per Coinbase docs)

### 8.2 REST client

- Base URLs:
  - Live: `https://api.coinbase.com/api/v3/brokerage`
  - Sandbox: `https://api-sandbox.coinbase.com/api/v3/brokerage`
- Every response goes through a Zod schema in `packages/coinbase/src/schemas.ts`
- 429 handling: exponential backoff with jitter, max 3 retries on idempotent GETs only
- Network errors on order-creation calls: do NOT retry. Surface as `submission_failed` and let reconciliation pick up state.

### 8.3 WebSocket clients

- Public market data: `wss://advanced-trade-ws.coinbase.com` — no auth, subscribe to `ticker`, `level2`, `candles`
- User orders: `wss://advanced-trade-ws-user.coinbase.com` — JWT in subscription message, subscribe to `user`
- Auto-reconnect with exponential backoff. On reconnect, refetch state via REST and resume.

### 8.4 Schemas

All Coinbase response shapes are mirrored as Zod schemas in `packages/coinbase/src/schemas.ts`. Fixtures saved under `tests/fixtures/coinbase/` (one file per endpoint × {success, error, edge cases}).

## 9. Trading loop pseudocode

The worker's main loop, simplified:

```typescript
async function tradingLoopTick(correlationId: string) {
  // 1. Mode + kill switch check
  if (await ops.isKillSwitchActive()) return logHalted('kill_switch');
  if (await ops.isPaused()) return logHalted('paused');
  const mode = await ops.getMode();

  // 2. For each enabled product
  for (const productId of config.enabledProducts) {
    // 3. Pull market data
    const candles = await client.getCandles({ productId, timeframe: '15m', ... });
    const bba = await client.getBestBidAsk(productId);
    const marketSnapshot = await persist.saveMarketSnapshot({ productId, ... });

    // 4. Features
    const features = computeFeatures({ productId, candles, bestBidAsk: bba });
    const featureSnapshot = await persist.saveFeatureSnapshot({ ...features, correlationId });

    // 5. AI context
    const aiInput = buildAIContextInput({ features, portfolio, policy });
    const aiContext = await aiAgent.generateContext(aiInput);
    const aiContextRow = await persist.saveAIContext({ aiContext, correlationId, ... });

    // 6. Strategy
    const decision = strategy.decide({ features, aiContext, portfolio, riskPolicy });
    if (decision.kind === 'hold') { await persist.saveHold(...); continue; }

    // 7. Persist intent
    const intent = await persist.saveTradeIntent({ ...decision.intent, correlationId });

    // 8. Risk
    const riskDecision = risk.evaluate({ intent, portfolio, policy, mode, killSwitchActive: false });
    await persist.saveRiskDecision({ ...riskDecision, tradeIntentId: intent.id });
    if (!riskDecision.approved) continue;

    // 9. Execute automatically in paper/sandbox. In live mode, persist the
    // previewed proposal and stop pending a separate operator action.
    const result = await execution.executeApproved({
      intent,
      decision: riskDecision,
      approval: null,
      client,
      mode,
    });
    await persist.saveExecutionResult({ result, intent });
  }
}
```

## 10. Error taxonomy

Custom error classes in `packages/core/src/errors.ts`. Each maps to a halt/skip/retry strategy:

| Error | Trigger | Action |
|---|---|---|
| `ConfigValidationError` | Bad env at startup | Exit(1) |
| `CoinbaseAuthError` | JWT gen failure | Halt loop, alert |
| `CoinbaseRateLimitError` | 429 | Backoff + retry on GET only |
| `CoinbaseSchemaError` | Zod parse fail on response | Halt loop, alert, save raw payload as fixture |
| `StaleMarketDataError` | WS data older than threshold | Skip product this tick |
| `LLMSchemaError` | AI output fails Zod | Return doNotTrade context, continue |
| `RiskRejectedError` | Risk engine declined | Persist + log; not an exception in normal flow |
| `ReconciliationDriftError` | Drift exceeds threshold | Trigger circuit breaker |
| `KillSwitchActiveError` | Any order path hits active kill switch | Refuse, log ops_event |
| `OperatorApprovalError` | Approval missing, stale, reused, rejected, or mismatched | Refuse submission, persist reason, alert on integrity mismatch |
| `ProfileConflictError` | Explicit facts conflict or required facts are stale | Ask operator to resolve; fall back to non-personalized education |
| `LearningStoreError` | Learning persistence unavailable or malformed | Disable learning/personalized advice; preserve deterministic safety operations |
| `UnsupportedAdviceJurisdictionError` | Personalized advice requested outside enabled jurisdiction | Provide general education only and record the guardrail decision |

## 11. Backtest harness (`packages/backtest/`)

- Reads historical candles from `tests/fixtures/history/` (CSV or Parquet).
- Replays through the SAME `Strategy` and `RiskEngine` instances used in production.
- Simulates fills with configurable fee + slippage models.
- Produces a report: PnL, max drawdown, Sharpe, win rate, trade count, average trade duration.
- CLI: `pnpm backtest --strategy ai-assisted-trend --product BTC-USD --start 2025-01-01 --end 2025-04-01`

## 12. Observability

### Metrics (prom-client)

- `crypto_guy_loop_iterations_total{result="ok|halted|error"}`
- `crypto_guy_loop_duration_seconds` (histogram)
- `crypto_guy_orders_submitted_total{mode,product,side}`
- `crypto_guy_orders_rejected_total{reason}`
- `crypto_guy_order_proposals_total{status}`
- `crypto_guy_operator_approval_duration_seconds` (histogram)
- `crypto_guy_approval_validation_failures_total{reason}`
- `crypto_guy_education_responses_total{topic,result}`
- `crypto_guy_learning_items_total{kind,status}`
- `crypto_guy_profile_corrections_total{key}`
- `crypto_guy_advice_total{result,jurisdiction}`
- `crypto_guy_change_proposals_total{kind,status}`
- `crypto_guy_advice_calibration_error` (gauge; defined by eval methodology)
- `crypto_guy_risk_rule_failures_total{rule}`
- `crypto_guy_ai_context_latency_seconds` (histogram)
- `crypto_guy_coinbase_rest_latency_seconds{endpoint}` (histogram)
- `crypto_guy_ws_reconnects_total{stream}`
- `crypto_guy_reconciliation_drift_total{field}`
- `crypto_guy_realized_pnl_usd` (gauge)
- `crypto_guy_drawdown_pct` (gauge)

### Structured logs

Every log line includes: `correlationId`, `productId` (when relevant), `mode`, `loopIteration`.

### Alerts

Conditions (defined in code; alerting transport pluggable):
- Kill switch activated
- Any live order submitted
- Live proposal awaiting operator decision or nearing expiry
- Profile conflict or unsupported personalized-advice jurisdiction
- Learned strategy/risk change awaiting operator review
- Daily loss halt triggered
- Order rejection spike (>N/min)
- Reconciliation drift > threshold
- Stale market data > threshold
- JWT generation failed
- Schema parse failure
