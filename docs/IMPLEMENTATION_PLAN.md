# Implementation Plan: ACT v1

Phase-by-phase ticket list for Claude Code. Each ticket is sized to fit in one focused working session and ends with explicit acceptance criteria.

**How to use this file:**
1. Find the lowest-numbered ticket whose dependencies are all checked.
2. Work through the ticket's "Files to touch" and "Acceptance criteria".
3. Run `pnpm typecheck && pnpm test`. If green, check the box and update [PRD.md](./PRD.md) §"Success metrics" if applicable.
4. Move to the next.

Reference docs: [PRD.md](./PRD.md) · [TECH_SPEC.md](./TECH_SPEC.md) · [autonomous_crypto_trading_agent_architecture.md](./autonomous_crypto_trading_agent_architecture.md) · [CLAUDE.md](./CLAUDE.md)

---

## Phase 1: Scaffolding

### T1.1 — Monorepo bootstrap
- **Depends on:** none
- **Files to touch:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `.nvmrc`
- **Scope:** Initialize pnpm workspace with packages and apps directories per [CLAUDE.md §"Repository layout"]. Configure TypeScript strict mode (no implicit any, strict null checks). Set up Vitest at the root.
- **Acceptance:**
  - [x] `pnpm install` succeeds on a clean clone
  - [x] `pnpm typecheck` and `pnpm test` exit 0 with no test files yet
  - [ ] Empty package stubs (`packages/core`, `packages/coinbase`, `packages/market-data`, `packages/strategy`, `packages/ai`, `packages/risk`, `packages/execution`, `packages/persistence`, `packages/backtest`) each export a placeholder `version` const

### T1.2 — Core types and errors
- **Depends on:** T1.1
- **Files to touch:** `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/core/src/events.ts`
- **Scope:** Implement branded types, error classes, and event type union per [TECH_SPEC.md §1, §2, §10].
- **Acceptance:**
  - [ ] All types compile under strict mode
  - [ ] Unit tests verify branded-type assertions catch wrong-brand assignment at compile time (via tsc tests)
  - [ ] Error classes correctly subclass `Error` and serialize cleanly to JSON

### T1.3 — Config loader
- **Depends on:** T1.2
- **Files to touch:** `packages/core/src/config.ts`, `packages/core/src/config.test.ts`, `.env.example`
- **Scope:** Implement Zod-validated `loadConfig()` per [TECH_SPEC.md §3]. Including the two `.refine()` guards for live mode.
- **Acceptance:**
  - [x] Valid paper-mode env passes
  - [x] Live mode without `LIVE_TRADING_ACK=true` fails with a clear error
  - [x] Live mode with `MAX_TRADE_NOTIONAL_USD > 50` fails with a clear error
  - [x] Missing required vars fail with a clear error per field
  - [x] Returned object is `Object.freeze`d

### T1.4 — Logger and time helpers
- **Depends on:** T1.2
- **Files to touch:** `packages/core/src/logger.ts`, `packages/core/src/time.ts`, tests
- **Scope:** pino logger with correlationId mixin. Time helpers: `now()`, `secondsBetween()`, a `Clock` interface for test injection.
- **Acceptance:**
  - [x] Logger emits valid JSON with required fields
  - [x] `Clock` interface allows freezing time in tests

### T1.5 — Docker Compose for Postgres + Redis
- **Depends on:** none (can run in parallel with T1.1)
- **Files to touch:** `infra/docker-compose.yml`, `infra/README.md`
- **Scope:** Postgres 15, Redis 7, named volumes, health checks, exposed ports.
- **Acceptance:**
  - [x] `docker compose -f infra/docker-compose.yml up -d` brings both services healthy in < 30s
  - [x] Down + up preserves data

### T1.6 — Drizzle schema and migrations
- **Depends on:** T1.3, T1.5
- **Files to touch:** `packages/persistence/src/schema.ts`, `packages/persistence/drizzle.config.ts`, `packages/persistence/migrations/`
- **Scope:** Implement all tables per [TECH_SPEC.md §4]. Generate initial migration.
- **Acceptance:**
  - [ ] `pnpm db:migrate` applies cleanly against the docker-compose Postgres
  - [ ] All FKs and indices present
  - [ ] `pnpm db:studio` opens and shows empty tables

### T1.7 — Persistence repositories
- **Depends on:** T1.6
- **Files to touch:** `packages/persistence/src/repositories/*.ts`, tests
- **Scope:** One repository per aggregate (orders, fills, positions, ai_contexts, trade_intents, risk_decisions, market_snapshots, feature_snapshots, ops_events, paper_fills, portfolio_snapshots). Pure functions over the Drizzle client.
- **Acceptance:**
  - [ ] Integration tests insert + read round-trip every table
  - [ ] All time fields stored as `timestamptz`

---

## Phase 2: Paper trading

### T2.1 — ExchangeClient interface + PaperClient
- **Depends on:** T1.2, T1.7
- **Files to touch:** `packages/coinbase/src/exchange-client.ts` (interface), `packages/coinbase/src/paper-client.ts`, `packages/coinbase/src/public-rest.ts` (just public endpoints — no auth needed)
- **Scope:** Per [TECH_SPEC.md §5.1]. `PaperClient` reads candles + best bid/ask from the public Coinbase REST endpoints; simulates orders in memory; persists paper fills.
- **Acceptance:**
  - [ ] `PaperClient.getCandles({ productId: 'BTC-USD', timeframe: '15m', ... })` returns real data
  - [ ] `PaperClient.createOrder(...)` produces a deterministic simulated fill given a fixed clock + slippage model
  - [ ] Unit tests use a `Clock` and fixture candles to verify slippage application

### T2.2 — Feature engine
- **Depends on:** T2.1
- **Files to touch:** `packages/market-data/src/features.ts`, `packages/market-data/src/features.test.ts`
- **Scope:** Implement `computeFeatures` per [TECH_SPEC.md §5.2]. Pure function.
- **Acceptance:**
  - [x] Tests verify each feature against known-output fixtures
  - [x] No I/O, no `Date.now()` calls inside

### T2.3 — AI context agent
- **Depends on:** T2.2, T1.3
- **Files to touch:** `packages/ai/src/llm-client.ts`, `packages/ai/src/context-agent.ts`, `packages/ai/src/prompts/market-context.ts`, `packages/ai/src/build-input.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.3, §6]. `LLMClient` is a thin provider-neutral interface; first implementation uses Anthropic SDK. `buildAIContextInput` is the secret-stripping whitelist function.
- **Acceptance:**
  - [x] `buildAIContextInput` strips everything not in the whitelist (test enforces this with object key comparison)
  - [x] Schema parse failures produce a `{ doNotTrade: true, ... }` context, not an exception
  - [x] Persists row in `ai_contexts` for every call
  - [ ] Static check fails CI if any string template in `prompts/` references a denylisted variable name (`apiKey`, `privateKey`, `jwt`, `accountId`, etc.)

### T2.4 — Deterministic strategy: ai-assisted-trend
- **Depends on:** T2.2, T2.3
- **Files to touch:** `packages/strategy/src/strategy-engine.ts`, `packages/strategy/src/strategies/ai-assisted-trend.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.4] and architecture doc §"Deterministic strategy example".
- **Acceptance:**
  - [x] Returns `hold` when `aiContext.doNotTrade === true`
  - [x] Returns `hold` when spread, volatility, or daily PnL guards trip
  - [x] Returns `enter` only when all positive conditions stack
  - [x] Strategy version string is stamped on every intent
  - [x] Fixture tests cover the full decision matrix

### T2.5 — Risk engine
- **Depends on:** T1.3
- **Files to touch:** `packages/risk/src/risk-engine.ts`, `packages/risk/src/policies.ts`, `packages/risk/src/rules/*.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.5]. One rule per file, each a pure function.
- **Acceptance:**
  - [x] Unit tests for each rule (positive + negative cases)
  - [x] **Property tests** (fast-check): generate arbitrary intents + portfolios; assert the engine never approves when any single rule would reject
  - [x] `RiskDecision.ruleResults` includes a row for every rule (even passing ones, for audit)

### T2.6 — Ops control service
- **Depends on:** T1.5, T1.7
- **Files to touch:** `packages/risk/src/ops-control.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.8]. Dual write Redis + Postgres.
- **Acceptance:**
  - [x] Activating kill switch is visible in next Redis read in < 100ms
  - [ ] Redis flush still leaves Postgres state intact and a follow-up read repopulates Redis
  - [x] Live-mode API call to clear kill switch is refused (verified with tests)

### T2.7 — Trading loop (paper mode)
- **Depends on:** T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T1.7
- **Files to touch:** `apps/worker/src/loop.ts`, `apps/worker/src/index.ts`, tests
- **Scope:** Implement the loop per [TECH_SPEC.md §9]. Pull all pieces together. Persist the full audit chain per [PRD §G2].
- **Acceptance:**
  - [x] `pnpm paper:once` runs one tick and exits 0
  - [ ] After a run, all of `market_snapshots`, `feature_snapshots`, `ai_contexts`, `trade_intents`, `risk_decisions` have new rows for the run's correlationId
  - [x] If risk approves, `paper_fills` has a new row
  - [ ] Loop respects pause and kill switch (integration test)

### T2.8 — Backtest runner
- **Depends on:** T2.4, T2.5
- **Files to touch:** `packages/backtest/src/backtest-runner.ts`, `packages/backtest/src/simulator.ts`, `packages/backtest/bin/backtest.ts`
- **Scope:** Per [TECH_SPEC.md §11]. Reuses the same `Strategy` and `RiskEngine` instances as production.
- **Acceptance:**
  - [x] CLI runs against a fixture CSV and prints a report
  - [x] Report includes PnL, max drawdown, Sharpe, win rate, trade count
  - [x] Identical strategy code in backtest as in worker (verified by importing the same module)

---

## Phase 3: Coinbase sandbox

### T3.1 — JWT auth
- **Depends on:** T1.3
- **Files to touch:** `packages/coinbase/src/auth.ts`, tests
- **Scope:** Per [TECH_SPEC.md §8.1]. ES256, 120s TTL, fresh per request.
- **Acceptance:**
  - [ ] Generates valid JWT verifiable with a public key
  - [ ] Tokens never persisted (logger redacts; test asserts no `eyJ` substring in any log line)
  - [ ] `nbf` and `exp` are correct relative to injected `Clock`

### T3.2 — Coinbase REST client
- **Depends on:** T3.1
- **Files to touch:** `packages/coinbase/src/rest-client.ts`, `packages/coinbase/src/schemas.ts`, fixtures
- **Scope:** Per [TECH_SPEC.md §5.1, §8.2]. Every response parsed through Zod.
- **Acceptance:**
  - [ ] Fixture-based tests cover all endpoints listed in §5.1
  - [ ] 429 retry behavior verified
  - [ ] Order-create errors do NOT retry (test asserts single attempt)
  - [ ] Schema parse failure throws `CoinbaseSchemaError` and saves raw payload to a debug directory

### T3.3 — Sandbox integration tests
- **Depends on:** T3.2
- **Files to touch:** `tests/integration/coinbase-sandbox.test.ts`
- **Scope:** Preview, create, cancel, list against `https://api-sandbox.coinbase.com/...`. Tagged so they only run with `RUN_SANDBOX=true`.
- **Acceptance:**
  - [ ] All four flows pass against sandbox
  - [ ] PRD §M is updated to confirm sandbox shape parity

### T3.4 — WebSocket clients
- **Depends on:** T3.1, T3.2
- **Files to touch:** `packages/coinbase/src/ws-public.ts`, `packages/coinbase/src/ws-user.ts`, tests
- **Scope:** Per [TECH_SPEC.md §8.3]. Auto-reconnect with backoff. On reconnect, REST refetch + resume.
- **Acceptance:**
  - [ ] Public ticker subscription receives events against the live public endpoint
  - [ ] Forced disconnect triggers reconnect and a state refetch (mocked test)

---

## Phase 4: Live read-only shadow

### T4.1 — Coinbase REST + WS in worker behind mode gate
- **Depends on:** T2.7, T3.2, T3.4
- **Files to touch:** `apps/worker/src/wiring.ts`, `apps/worker/src/loop.ts`
- **Scope:** When `TRADING_MODE=live`, market data comes from Coinbase. All order paths still routed through `PaperClient`. No real order is submitted.
- **Acceptance:**
  - [ ] Live mode runs the full loop with real data
  - [ ] Zero calls to Coinbase create/cancel order endpoints (verified by HTTP mock)
  - [ ] Shadow PnL is queryable from `paper_fills`

### T4.2 — Reconciliation service
- **Depends on:** T3.2, T2.7
- **Files to touch:** `packages/execution/src/reconciliation.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.7]. Schedule + drift detection + circuit breaker trigger.
- **Acceptance:**
  - [ ] Synthetic drift triggers `ReconciliationDriftDetected`
  - [ ] N drift events within window triggers circuit breaker (verified)

### T4.3 — Operator API
- **Depends on:** T2.6, T1.7
- **Files to touch:** `apps/api/src/server.ts`, `apps/api/src/routes/*.ts`, tests
- **Scope:** Per [TECH_SPEC.md §7]. Bearer auth with `OPERATOR_API_TOKEN`.
- **Acceptance:**
  - [ ] All endpoints documented in §7 are implemented
  - [ ] Unauthorized requests return 401
  - [ ] `/health` returns 200 only when DB, Redis, and worker heartbeat are all healthy
  - [ ] Postman/curl examples in `apps/api/README.md`

### T4.4 — Metrics + structured logs
- **Depends on:** T2.7, T4.3
- **Files to touch:** `packages/core/src/metrics.ts`, instrument the worker and API
- **Scope:** Per [TECH_SPEC.md §12]. Prom-client metrics + correlationId on every log line.
- **Acceptance:**
  - [ ] `/metrics` endpoint serves Prometheus format
  - [ ] All metrics listed in §12 are emitted in a representative run

---

## Phase 5: Live micro-orders

### T5.1 — ExecutionService live path
- **Depends on:** T3.2, T2.5, T4.2
- **Files to touch:** `packages/execution/src/order-preview.ts`, `packages/execution/src/execution-engine.ts`, tests
- **Scope:** Per [TECH_SPEC.md §5.6]. Always preview when `requireOrderPreview=true`. Idempotency via `clientOrderId`.
- **Acceptance:**
  - [ ] Preview-rejected orders never reach `createOrder`
  - [ ] `clientOrderId` is generated and persisted BEFORE network call
  - [ ] Sandbox integration test exercises preview → create → cancel happy path

### T5.2 — Alerts
- **Depends on:** T4.3, T4.4
- **Files to touch:** `packages/core/src/alerts.ts`, transport adapter (start with stdout + webhook), wiring
- **Scope:** Implement the alert conditions in [TECH_SPEC.md §12]. Transport pluggable; ship a webhook adapter and a stdout adapter.
- **Acceptance:**
  - [ ] Every live order produces an alert in < 10s ([PRD §M8])
  - [ ] Kill switch activation produces an alert immediately
  - [ ] Daily loss halt produces an alert and a circuit breaker trigger

### T5.3 — Live trading dry-run gate
- **Depends on:** T5.1, T5.2, T4.2
- **Files to touch:** `apps/worker/src/startup-checks.ts`
- **Scope:** Implement the full [LIVE_TRADING_CHECKLIST.md](./LIVE_TRADING_CHECKLIST.md) as a startup gate that the operator can dry-run.
- **Acceptance:**
  - [ ] `pnpm live:preflight` runs every checklist item and prints pass/fail
  - [ ] Any fail blocks startup in live mode

### T5.4 — First live micro-order rollout
- **Depends on:** T5.3, all of Phase 4
- **Files to touch:** none (operational)
- **Scope:** Operator runs the system in live mode with bootstrap notional ($25). Reviews logs and PnL daily.
- **Acceptance:**
  - [ ] 30 consecutive days of stable operation with zero kill-switch surprises
  - [ ] All [PRD §M7–M10] metrics met
  - [ ] No notional increase before this period completes

---

## Cross-cutting tickets (work anytime after Phase 1)

### TX.1 — CI pipeline
- **Files:** `.github/workflows/ci.yml`
- **Scope:** Run `pnpm typecheck`, `pnpm test`, `pnpm test:property` on every PR.
- **Acceptance:** CI passes on a clean main; fails on a deliberate breakage.

### TX.2 — Secret-leak static check
- **Files:** `scripts/check-no-secrets-in-prompts.ts`, wired into CI
- **Scope:** Per [PRD §S5]. Greps `packages/ai/src/prompts/` for denylisted variable names.
- **Acceptance:** Adding `apiKey` to a prompt file fails CI.

### TX.3 — Pre-commit hook
- **Files:** `.husky/pre-commit`
- **Scope:** Run `pnpm typecheck` and changed-file tests.

---

## Definition of done (per ticket)

A ticket is done only when:
1. All acceptance criteria checked
2. `pnpm typecheck && pnpm test` green
3. No new top-level deps added without updating [CLAUDE.md §"Tech stack"]
4. If the ticket changed a safety rule, [PRD.md §S1-S5] and [RISK_POLICY.md] are updated to match
5. Commit message references the ticket ID (e.g. `T2.5: implement risk engine with property tests`)
