# Crypto Guy Architecture

## Executive summary

This plan defines a TypeScript-first interactive crypto trading system targeting Coinbase Advanced Trade. The LLM may summarize market context, classify regimes, and explain trade rationale. Deterministic strategy and risk services may produce an eligible proposal, but an operator must explicitly approve every strategy-generated live order after preview and before submission. Coinbase Advanced Trade supports programmatic trading and order management through REST APIs and real-time market data through WebSockets, so the architecture separates market-data ingestion, signal generation, risk checks, order preview, operator approval, execution, monitoring, and audit logging into independently testable modules ([Coinbase Advanced Trade API overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview)).

The recommended build path is paper-trading first, then Coinbase sandbox/test-mode behavior, then live trading behind explicit environment gates and per-order operator approval. Coinbase’s Advanced Trade sandbox returns production-shaped responses from a sandbox base URL, but the documented sandbox responses are static and predefined, so it is useful for integration shape and error-handling tests, not for realistic strategy validation ([Coinbase Advanced Trade API sandbox](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox)).

This is an engineering architecture, not financial advice. The system should never guarantee profits, should never bypass configured risk limits, and should default to capital preservation, observability, and kill-switch behavior over trade frequency.

## Product goal

Build a modular interactive trading platform that can:

- **Ingest market data**: Pull candles, product metadata, top-of-book data, and live market events from Coinbase.
- **Generate AI-assisted context**: Use an LLM to summarize market state, news context if added later, volatility regime, and anomalous behavior.
- **Educate the operator**: Explain what trading concepts mean, how mechanisms work, why they matter, and how they apply to the current decision.
- **Personalize advice**: Use an approved, versioned operator profile and reviewable learned insights to tailor guidance without granting execution authority.
- **Generate deterministic signals**: Convert market features into machine-checkable buy, sell, hold, or reduce-position recommendations.
- **Enforce risk policy**: Apply hard limits before any order preview or execution.
- **Preview and propose orders**: Use Coinbase order preview after risk approval, then present an immutable proposal for operator review.
- **Execute approved proposals**: Submit a live order only after a single-use operator approval bound to the exact preview.
- **Track state**: Persist positions, balances, orders, fills, strategy decisions, prompts, LLM outputs, and execution outcomes.
- **Provide operator controls**: Expose dry-run/live mode, proposal review, approve/reject, pause, resume, cancel-open-orders, and global kill switch.
- **Provide a premium operator experience**: Use a coherent accessible design system, responsive layouts, progressive disclosure, complete state handling, and safety-focused approval UX.

## Non-goals for v1

- **No fully discretionary LLM trading**: The LLM should not be allowed to emit raw executable orders. It can emit structured context that deterministic strategy code consumes.
- **No leverage or perpetual futures by default**: Keep v1 spot-only unless you explicitly choose to add futures later. Coinbase documents perpetual futures support for eligible users and regions, but that adds liquidation, margin, and regulatory complexity that should be isolated from the first build ([Coinbase perpetual futures guide](https://docs.cdp.coinbase.com/coinbase-business/advanced-trade-apis/guides/perpetual)).
- **No multi-exchange routing**: Design adapters so this can be added later, but implement Coinbase first.
- **No unattended live execution**: Live trading requires explicit configuration, scoped API keys, small position limits, and separate approval for each strategy-generated order.

## Recommended stack

- **Runtime**: Node.js with TypeScript.
- **API service**: Fastify for a lightweight control plane.
- **Worker runtime**: BullMQ plus Redis, or a single-process Temporal-lite pattern for v1.
- **Database**: PostgreSQL with Drizzle.
- **Cache/stream state**: Redis for locks, kill-switch state, short-lived market snapshots, and worker heartbeats.
- **Validation**: Zod for every external API response, internal event, LLM output, and order intent.
- **LLM layer**: Provider-neutral adapter with structured JSON output and strict schemas.
- **Observability**: Structured pino JSON logs and Prometheus-compatible metrics for v1; OpenTelemetry and error aggregation may be added later.
- **Deployment**: Docker Compose locally, then Railway, Fly.io, or a small VPS for always-on workers.

## Coinbase integration facts that shape the design

- **REST and WebSocket split**: Coinbase Advanced Trade provides REST endpoints for trading/order management and WebSocket protocols for real-time market data, so the agent should not poll everything through REST when live subscriptions are more appropriate ([Coinbase Advanced Trade API overview](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview)).
- **JWT authentication**: Coinbase CDP authentication uses JWT bearer tokens for API calls, with Coinbase examples showing a default expiration of 120 seconds; the auth module should generate short-lived JWTs per request or connection and avoid sharing tokens across unrelated requests ([Coinbase JWT authentication](https://docs.cdp.coinbase.com/get-started/authentication/jwt-authentication)).
- **Private endpoint permissions**: Coinbase documents permissions such as view for account/order/product reads and trade for create/cancel order operations, so API keys should be scoped least-privilege and split between read-only and trade-capable environments where practical ([Coinbase Advanced Trade API endpoints](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)).
- **Order lifecycle endpoints**: Coinbase documents create order, cancel orders, edit order, list orders, list fills, get order, preview order, and related order-management flows, which maps cleanly to separate preview, execution, reconciliation, and recovery services ([Coinbase order management guide](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/orders)).
- **Sandbox limitation**: The Coinbase Advanced Trade sandbox is useful for response contracts because it uses the sandbox base URL `https://api-sandbox.coinbase.com/api/v3/brokerage/{resource}`, but documented responses are mocked/static, so backtesting and paper trading must use your own simulation layer for realistic performance evaluation ([Coinbase Advanced Trade API sandbox](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox)).
- **WebSocket endpoints**: Coinbase documents a public market-data WebSocket endpoint and a user-order-data WebSocket endpoint, with user-specific channels requiring JWT authentication; the agent should separate public market subscriptions from authenticated user/order subscriptions ([Coinbase WebSocket guide](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/websocket)).

## Architecture

### High-level system flow

```text
Coinbase REST/WebSocket
        |
        v
Market Data Ingestion ---> Feature Engine ---> Strategy Engine
        |                        |                  |
        |                        v                  v
        |                 Market Context       Trade Intent
        |                        |                  |
        v                        v                  v
Persistence <------------ AI Context Agent ---> Risk Engine
        ^                                           |
        |                                           v
Reconciliation <--- Execution Engine <--- Operator Approval <--- Order Preview
        |
        v
Operator Console / Alerts / Kill Switch
```

Education and learning run alongside this flow: interactions and outcomes produce evidence; the learning service updates education progress and proposes reviewable insights; the advice service reads an immutable profile version; and any proposed strategy or risk change enters a separate operator-approval workflow. Learning never writes directly to strategy, risk, or execution state.

### Core services

- **MarketDataService**: Normalizes candles, trades, bid/ask snapshots, product metadata, and WebSocket events into internal market events.
- **FeatureEngine**: Computes deterministic features such as moving averages, volatility, returns, volume anomalies, spread, trend strength, drawdown, and liquidity filters.
- **AIContextAgent**: Produces structured commentary only. Example fields: `regime`, `volatility_summary`, `risk_notes`, `confidence`, `contradictions`, and `do_not_trade_reasons`.
- **EducationService**: Produces level-appropriate “what, how, why, risks, example, check” learning units and tracks demonstrated understanding.
- **LearningService**: Records explicit facts, evidence, education progress, and derived insights with provenance, confidence, scope, and retention. Inferences are reviewable and cannot overwrite user-provided facts.
- **AdviceService**: Produces profile-aware guidance that cites the profile version, relevant facts, evidence, assumptions, contrary signals, alternatives, downside scenarios, and invalidation conditions.
- **ChangeProposalService**: Converts learned strategy or risk suggestions into immutable proposals requiring separate operator approval and rollback criteria.
- **StrategyEngine**: Generates trade intents using deterministic rules plus optional AI context inputs. Example output: `BUY BTC-USD, max_quote_size: 25, reason_code: trend_pullback_confirmed`.
- **RiskEngine**: Enforces hard constraints, including product allowlist, max notional per trade, max daily loss, max open positions, cool-down period, slippage threshold, volatility halt, and circuit breaker.
- **OrderPreviewService**: Calls Coinbase preview/order-validation paths before any live order. Coinbase documents a preview-orders endpoint under private endpoints with view permission, making preview a useful pre-execution checkpoint ([Coinbase Advanced Trade API endpoints](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)).
- **ApprovalService**: Persists immutable proposals and validates single-use operator decisions against intent and preview hashes. Approval state fails closed on absence, expiry, reuse, rejection, mismatch, or storage failure.
- **ExecutionService**: Converts risk-eligible, operator-approved proposals into Coinbase order requests, stores client order IDs, and handles create, cancel, and status flows.
- **ReconciliationService**: Compares local order/position state to Coinbase orders, fills, accounts, and balances to detect drift.
- **PortfolioService**: Maintains current exposure, cash balance, available balance, realized PnL, unrealized PnL, and product-level allocation.
- **OpsControlService**: Owns kill switch, read-only mode, paper mode, max-risk profile, and environment gate status.

## AI-assisted strategy design

### Principle

The AI layer should never have direct exchange credentials and should never emit an executable order. It should receive bounded market summaries and return typed analysis that the deterministic strategy engine can use or ignore.

## Education, advice, and continuous learning

Crypto Guy uses controlled continuous learning:

1. **Education profile** — concepts encountered, demonstrated understanding, misconceptions, and suggested next topics.
2. **Operator profile** — explicit goals, experience, time horizon, liquidity needs, financial constraints, tax jurisdiction, and risk tolerance.
3. **Decision journal** — recommendations, operator decisions, rationale, outcomes, and retrospective lessons.
4. **Strategy research** — evidence-backed suggestions for strategy or risk changes. Suggestions have no effect until separately approved.

Every recommendation answers: what is happening; why it matters; how the conclusion was reached; how it relates to the approved profile; what could invalidate it; what alternatives exist, including no action; and what approval would do. Facts, estimates, assumptions, and opinions must be labeled separately. Confidence must be calibrated and never presented as certainty or a profit guarantee.

The operator can inspect, correct, accept, reject, export, and delete learned data. Conflicting facts trigger review. Missing or stale data reduces personalization. Learning-store failure disables profile updates and personalized advice but must not block pause, kill-switch, or cancellation. The initial scope is U.S.-based personal use. Any public or international personalized-advice release requires jurisdiction-specific legal and compliance review.

### LLM input

Provide compressed, non-secret context:

```json
{
  "product_id": "BTC-USD",
  "timeframe": "15m",
  "latest_price": "redacted_or_numeric_from_market_data",
  "features": {
    "trend": "up",
    "volatility_percentile": 72,
    "spread_bps": 4,
    "rsi_14": 61,
    "drawdown_from_24h_high_pct": 3.2
  },
  "portfolio_state": {
    "position_side": "flat",
    "exposure_pct": 0,
    "daily_pnl_pct": -0.4
  },
  "risk_policy": {
    "max_trade_notional_usd": 25,
    "max_daily_loss_pct": 1,
    "allow_new_positions": true
  }
}
```

### LLM output schema

```json
{
  "market_regime": "trend|range|high_volatility|illiquid|unknown",
  "summary": "string",
  "risk_notes": ["string"],
  "bullish_factors": ["string"],
  "bearish_factors": ["string"],
  "do_not_trade": true,
  "do_not_trade_reasons": ["string"],
  "confidence": 0.0
}
```

### Deterministic strategy example

The first AI-assisted strategy can be simple and auditable:

- **Long entry**: Allow a small buy only when trend features are positive, spread is below a threshold, volatility is not halted, the LLM does not set `do_not_trade`, and risk policy allows new exposure.
- **Exit/reduce**: Reduce position when stop-loss, trailing drawdown, momentum reversal, or daily loss controls trigger.
- **Hold**: Do nothing when the LLM flags uncertainty, deterministic indicators disagree, or risk state is degraded.
- **No shorting**: Keep spot-only v1 simple by disallowing short positions.

## Risk controls

### Hard controls

- **Mode gate**: `TRADING_MODE=paper|sandbox|live`, with `live` blocked unless `LIVE_TRADING_ACK=true` and `MAX_TRADE_NOTIONAL_USD` is explicitly set.
- **Product allowlist**: Start with `BTC-USD` and `ETH-USD`; reject anything else.
- **Max trade notional**: Default tiny value in live mode.
- **Max daily loss**: Stop opening new positions after configured daily drawdown.
- **Max portfolio exposure**: Cap crypto exposure by product and total account percentage.
- **Cool-down**: Prevent repeated entries in the same product within a configured window.
- **Slippage guard**: Reject order if preview/execution price deviates too far from signal price.
- **Volatility halt**: Stop trading during abnormal candle ranges or spread widening.
- **Circuit breaker**: Global kill switch in Redis and database.
- **Credential separation**: Read-only credentials for market/account views where possible; trade-enabled credentials only for the execution worker.

### Soft controls

- **LLM uncertainty penalty**: Lower or block trade eligibility when the AI context has low confidence or contradictory notes.
- **Trade budget**: Daily and weekly quote-currency budgets.
- **Human approval**: Required for every strategy-generated live order, regardless of size. Risk approval is necessary but not sufficient.

## Repository structure

```text
crypto-agent/
  apps/
    api/                         # Control plane and operator endpoints
    worker/                      # Trading loop, ingestion, reconciliation
    dashboard/                   # Local operator review and controls
  packages/
    coinbase/
      src/auth.ts                # JWT generation
      src/rest-client.ts         # Typed REST wrapper
      src/ws-client.ts           # WebSocket wrapper
      src/schemas.ts             # Zod response schemas
    core/
      src/events.ts              # Internal event types
      src/config.ts              # Env parsing and mode gates
      src/logger.ts
      src/time.ts
    market-data/
      src/ingestion.ts
      src/features.ts
      src/candles.ts
    strategy/
      src/strategy-engine.ts
      src/strategies/ai-assisted-trend.ts
      src/signal-types.ts
    ai/
      src/llm-client.ts
      src/context-agent.ts
      src/prompts/
    risk/
      src/risk-engine.ts
      src/policies.ts
      src/circuit-breaker.ts
    execution/
      src/order-preview.ts
      src/execution-engine.ts
      src/reconciliation.ts
    persistence/
      src/schema.ts              # Drizzle schema
      src/repositories/
    backtest/
      src/backtest-runner.ts
      src/simulator.ts
  infra/
    docker-compose.yml
    railway.json
  docs/
    ARCHITECTURE.md
    RUNBOOK.md
    RISK_POLICY.md
    LIVE_TRADING_CHECKLIST.md
  tests/
    integration/
    fixtures/
```

## Database model

### Core tables

- **products**: Supported Coinbase products, precision, min size, quote currency, status.
- **market_candles**: Product, timeframe, open/high/low/close/volume, source timestamp.
- **feature_snapshots**: Product, timeframe, feature JSON, generated timestamp.
- **ai_contexts**: Prompt hash, input snapshot reference, model, schema version, output JSON, latency, token metadata.
- **trade_intents**: Strategy output before risk approval.
- **risk_decisions**: Approved/rejected, policy version, rule results, rejection reasons.
- **order_proposals**: Immutable intent and preview hashes, preview payload, status, and expiry.
- **operator_approvals**: Proposal, actor, approve/reject decision, reason, hashes, decision time, and consumption time.
- **operator_profiles**: Versioned explicit facts, jurisdiction, goals, constraints, risk tolerance, effective time, and status.
- **learning_items**: Fact/inference/education-progress type, value, source, evidence links, confidence, scope, retention, review status, and timestamps.
- **advice_records**: Profile version, evidence, assumptions, recommendation, alternatives, confidence, model/strategy versions, operator response, and outcome links.
- **change_proposals**: Strategy/risk change, evidence, expected impact, downside, rollback criteria, decision, actor, and timestamps.
- **orders**: Client order ID, Coinbase order ID, product, side, type, status, request JSON, response JSON.
- **fills**: Fill ID, order ID, product, size, price, fee, timestamp.
- **positions**: Product exposure, average cost, realized/unrealized PnL.
- **portfolio_snapshots**: Cash, available balance, exposure, PnL, drawdown.
- **ops_events**: Kill switch changes, mode changes, config changes, deployment version.

## Trading loop

### Paper mode

1. Load enabled products and risk policy.
2. Pull recent candles and market snapshots.
3. Compute features.
4. Ask AI context agent for structured market context.
5. Run deterministic strategy.
6. Run risk engine.
7. Simulate order fill using conservative slippage and fee assumptions.
8. Persist the full decision chain.
9. Emit metrics and alerts.

### Sandbox mode

1. Use the same flow as paper mode.
2. Replace simulated order API calls with Coinbase sandbox order endpoints for request/response validation.
3. Do not use sandbox results to evaluate strategy performance because Coinbase documents the sandbox responses as mocked/static ([Coinbase Advanced Trade API sandbox](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox)).

### Live mode

1. Require `TRADING_MODE=live`, explicit live acknowledgement, valid scoped credentials, and a low max notional.
2. Pull account/portfolio balances.
3. Use real market data and previews.
4. Persist an immutable previewed proposal and wait for operator approval.
5. Place only proposals that are both risk-approved and explicitly operator-approved.
6. Reconcile local state after every order event.
7. Halt trading if reconciliation drift, API errors, stale data, or approval integrity checks exceed thresholds.

## API surface

### Operator endpoints

- `GET /health`: Service health, worker heartbeat, database connectivity.
- `GET /status`: Current mode, kill-switch state, active products, latest strategy run.
- `POST /ops/pause`: Pause new trades.
- `POST /ops/resume`: Resume new trades.
- `POST /ops/kill-switch`: Immediately block all new orders.
- `POST /ops/cancel-open-orders`: Cancel open orders for allowed products.
- `GET /portfolio`: Current positions and exposure.
- `GET /orders`: Recent orders, fills, and statuses.
- `GET /decisions`: Recent trade intents, risk decisions, and AI context.
- `GET /proposals`: Pending and recent live proposals with preview details and expiry.
- `POST /proposals/:id/approve`: Approve one exact current preview.
- `POST /proposals/:id/reject`: Reject one proposal with optional reason.
- `POST /backtests`: Start backtest job.

### Internal event types

- `MarketCandleClosed`
- `FeaturesComputed`
- `AIContextGenerated`
- `TradeIntentCreated`
- `RiskDecisionCreated`
- `OperatorApprovalRecorded`
- `OrderPreviewed`
- `OrderSubmitted`
- `OrderFilled`
- `ReconciliationDriftDetected`
- `CircuitBreakerTriggered`

## Testing strategy

- **Unit tests**: Feature calculations, strategy decisions, risk policies, mode gates, schema parsing, and Coinbase auth token builder.
- **Property tests**: Ensure risk engine never approves an order that violates max notional, allowlist, mode, or daily loss rules.
- **Approval tests**: Ensure missing, expired, reused, rejected, malformed, and preview-mismatched approvals never reach order submission; test concurrent approval consumption.
- **Learning tests**: Profile precedence, conflict handling, correction, rejection, deletion, retention, provenance, and failure isolation.
- **Advice evals**: Unsupported claims, misleading certainty, stale evidence, missing alternatives, risk omission, profile misuse, and outcome calibration.
- **Injection evals**: Instructions embedded in market data, documents, AI output, logs, or tool output cannot mutate durable learning, policy, or approval state.
- **Fixture tests**: Validate REST/WebSocket response parsers against saved Coinbase-shaped payloads.
- **Simulation tests**: Run strategy against historical candle fixtures with fees, slippage, partial fills, and latency.
- **Integration tests**: Exercise sandbox create/cancel/list order flows for request shape and error handling.
- **Chaos tests**: Simulate stale market data, rejected orders, network failures, duplicated WebSocket events, and partial fills.

## Security plan

- **Secrets**: Store Coinbase key name and private key only in environment variables or a secret manager.
- **JWT generation**: Generate short-lived tokens inside the Coinbase client layer; Coinbase documentation shows bearer JWT usage and examples with 120-second expiration, so tokens should not be persisted ([Coinbase JWT authentication](https://docs.cdp.coinbase.com/get-started/authentication/jwt-authentication)).
- **Least privilege**: Use view-only permissions for read services and trade permissions only for the execution worker where possible, reflecting Coinbase’s documented permission split across private endpoints ([Coinbase Advanced Trade API endpoints](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)).
- **Audit log**: Store whitelisted structured AI inputs or a prompt hash, parsed AI responses, feature snapshots, strategy intents, risk decisions, operator approvals, and order responses. Define retention and deletion before live operation; never persist secrets or raw sensitive tool output merely for convenience.
- **Learning privacy**: Minimize profile data, separate explicit facts from inferences, record provenance, apply configured retention, and provide inspect/correct/export/delete controls. Never learn from credentials, private keys, seed phrases, account identifiers, or raw sensitive tool output.
- **No secrets to LLM**: Never pass API keys, JWTs, account identifiers, or raw private keys into prompts.
- **Deployment guard**: Refuse startup in live mode if required safety variables are missing.

## Observability

- **Metrics**: Strategy runs, orders submitted, orders rejected, risk-rule failures, PnL, drawdown, API latency, LLM latency, WebSocket reconnects, stale data duration, reconciliation drift.
- **Logs**: Structured logs with correlation IDs from signal to order/fill.
- **Alerts**: Trigger alerts for kill switch, live order placement, daily loss halt, order rejection spike, reconciliation mismatch, stale market data, and failed JWT generation.
- **Dashboard**: Treat the local dashboard as a first-class product surface. It must expose system health, freshness, risk, education, advice provenance, memory controls, proposals, and safety actions through a coherent design system with responsive, accessible, fully tested states. Grafana-compatible metrics remain available for engineering observability.

## Rollout plan

### Phase 1: Architecture and scaffolding

- Create TypeScript monorepo.
- Add config validation, database schema, logger, and test harness.
- Stub Coinbase adapter, strategy engine, risk engine, and AI context agent.
- Add docs: `ARCHITECTURE.md`, `RISK_POLICY.md`, and `LIVE_TRADING_CHECKLIST.md`.

### Phase 2: Paper trading

- Implement market-data ingestion from public Coinbase endpoints.
- Build feature engine and deterministic AI-assisted trend strategy.
- Implement paper broker with conservative fill assumptions.
- Persist decisions, simulated orders, fills, and portfolio snapshots.
- Add backtest runner over historical candle fixtures.

### Phase 3: Coinbase sandbox integration

- Implement Coinbase auth and REST client.
- Add sandbox order preview/create/cancel/list flows.
- Validate request/response schemas and error handling.
- Keep sandbox isolated from performance metrics because responses are mocked/static ([Coinbase Advanced Trade API sandbox](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox)).

### Phase 4: Live read-only

- Connect live Coinbase read-only operations.
- Reconcile account, balances, orders, fills, and market data.
- Run the full strategy loop but block order submission.
- Compare intended orders against market outcomes for shadow-mode evaluation.

### Phase 5: Live micro-orders

- Enable trade-capable credentials only in the execution worker.
- Set tiny max notional, strict product allowlist, and mandatory per-order approval.
- Alert every live order.
- Review logs and PnL before increasing limits.

## Implementation checklist

- [ ] Create repo and monorepo tooling.
- [ ] Add Docker Compose for Postgres and Redis.
- [ ] Add Zod env validation with live-mode hard stops.
- [ ] Implement Coinbase REST client with JWT auth.
- [ ] Implement Coinbase WebSocket client.
- [ ] Implement feature engine.
- [ ] Implement AI context agent with structured output.
- [ ] Implement deterministic strategy.
- [ ] Implement risk engine and property tests.
- [ ] Implement paper broker.
- [ ] Implement order preview and execution services.
- [ ] Implement reconciliation worker.
- [ ] Implement operator API.
- [ ] Add observability and alerting.
- [ ] Write live trading runbook.

## Suggested v1 default configuration

```env
TRADING_MODE=paper
ENABLED_PRODUCTS=BTC-USD,ETH-USD
BASE_CURRENCY=USD
MAX_TRADE_NOTIONAL_USD=25
MAX_PRODUCT_EXPOSURE_PCT=10
MAX_TOTAL_EXPOSURE_PCT=20
MAX_DAILY_LOSS_PCT=1
MIN_SECONDS_BETWEEN_TRADES=1800
ALLOW_SHORTS=false
ALLOW_LEVERAGE=false
REQUIRE_ORDER_PREVIEW=true
LIVE_TRADING_ACK=false
```

## Key design decision

The safest architecture for this product is interactive execution with AI-assisted interpretation. The deterministic risk engine is a mandatory veto, and the operator is the final live-execution authority. Every order must be explainable from persisted inputs: market data, features, AI context, strategy intent, risk decision, preview response, attributable operator approval, and execution result.
