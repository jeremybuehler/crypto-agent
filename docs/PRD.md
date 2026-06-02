# PRD: Autonomous Crypto Trading Agent (ACT) v1

**Status:** Draft for implementation
**Owner:** Jeremy Buehler
**Last updated:** 2026-05-29
**Source of truth (technical):** [autonomous_crypto_trading_agent_architecture.md](./autonomous_crypto_trading_agent_architecture.md)

---

## 1. Problem and opportunity

Manual crypto trading is reactive, emotional, and bounded by attention. Existing retail bots either (a) hand the LLM full execution authority (unsafe) or (b) are pure deterministic rule engines that ignore the contextual reasoning LLMs are good at.

ACT is a safety-first autonomous trading platform where deterministic code is the final authority on every order, and an LLM provides structured market context that the strategy engine can use or ignore. The system must be observable enough that every live order is fully reconstructable from persisted inputs.

## 2. Goals

- **G1 — Capital preservation first.** No order ever bypasses the risk engine. Default mode is paper. Live mode requires explicit acknowledgement and tiny notional limits.
- **G2 — Explainable trades.** Every order traces back to: market snapshot → features → AI context → strategy intent → risk decision → preview → execution → fill.
- **G3 — Operator control.** Kill switch, pause, resume, cancel-open-orders, and reduce-only mode are always one API call away.
- **G4 — Promotion path.** Paper → sandbox shape tests → live read-only shadow → live micro-orders. Each phase has clear exit criteria before the next is unlocked.
- **G5 — Built for solo operation.** Single user, local-first, minimal auth. Optimize for safety and observability, not multi-tenancy.

## 3. Non-goals (v1)

- No discretionary LLM trading (LLM cannot emit executable orders).
- No leverage, no perpetual futures, no shorting.
- No multi-exchange. Coinbase Advanced Trade only. Adapter pattern preserved for later.
- No unattended live deployment. Live rollout is a deliberate human action.
- No mobile app, no public dashboard, no multi-user RBAC.

## 4. Target user

**Primary persona — Jeremy (solo operator/developer).**
- Comfortable with TypeScript, Postgres, Docker, and CLI workflows.
- Wants the system running on a small always-on VPS or local machine.
- Will operate the agent through API calls + persisted audit records, not a polished UI.
- Risk tolerance: extremely low for v1. Will not enable live mode until paper + sandbox have proven reliability for at least 2 weeks of continuous operation.

## 5. User stories

### Operator stories

| ID | As an operator, I want to... | Acceptance criteria |
|---|---|---|
| U1 | Run the agent in paper mode with one command | `pnpm paper:once` executes a full loop (ingest → features → AI → strategy → risk → simulated fill → persist) and exits cleanly. |
| U2 | Inspect every decision the agent made | Postgres queries against `ai_contexts`, `trade_intents`, `risk_decisions`, `orders`, `fills` return the full chain for any timestamp. |
| U3 | Halt all trading instantly | `POST /ops/kill-switch` blocks all new orders within one loop tick; existing open orders remain unchanged unless cancel is also called. |
| U4 | Cancel all open orders | `POST /ops/cancel-open-orders` issues cancels for every order in `open` state for allowlisted products. |
| U5 | Verify health before promoting modes | `GET /health` returns DB connectivity, worker heartbeat, last Coinbase REST/WS contact, and current mode. |
| U6 | Promote to live mode safely | App refuses to start in `TRADING_MODE=live` unless `LIVE_TRADING_ACK=true`, `MAX_TRADE_NOTIONAL_USD` ≤ bootstrap limit, and scoped trade credentials are present. |
| U7 | Backtest a strategy against history | `POST /backtests` runs a strategy over saved candle fixtures with fee/slippage assumptions and returns PnL, drawdown, Sharpe, and trade log. |

### System stories (acceptance criteria from architecture doc §"Risk controls" and §"Trading loop")

| ID | The system must... | Acceptance criteria |
|---|---|---|
| S1 | Never approve a trade that violates any hard limit | Property tests prove risk engine rejects when product not in allowlist, notional > max, daily loss breached, exposure > cap, mode = paper but order is live-bound, kill switch active. |
| S2 | Reconcile local state to Coinbase | Reconciliation job runs every N seconds; drift events ≥ configured threshold trigger circuit breaker. |
| S3 | Refuse to start if config is unsafe | Zod env validation fails fast with a clear error if any required live-mode variable is missing or out of range. |
| S4 | Generate short-lived JWTs per Coinbase request | No JWT lives longer than 120 seconds. No JWT is persisted or logged. |
| S5 | Never pass secrets to the LLM | Prompts are constructed from a whitelisted set of numeric/categorical fields. Static check + unit test enforce this. |

## 6. Success metrics

### Phase 1 (paper trading, target: 2 weeks)
- **M1:** ≥ 99% loop completion rate (loops that emit a persisted decision row, even if "hold").
- **M2:** Zero risk-engine bypass incidents (property tests + production audit).
- **M3:** 100% of LLM outputs validate against Zod schema or get caught and logged as failures (no silent passes).
- **M4:** Median end-to-end loop latency < 5s (ingest → persist).

### Phase 4 (live read-only shadow, target: 1 week)
- **M5:** Shadow PnL is reconstructable from logs alone.
- **M6:** Reconciliation drift count = 0 over a 24h window.

### Phase 5 (live micro-orders, ongoing)
- **M7:** 100% of live orders pass through preview before execution.
- **M8:** Every live order generates an alert within 10s.
- **M9:** Daily drawdown never exceeds `MAX_DAILY_LOSS_PCT`.
- **M10:** Kill switch activation halts new orders in < 1s (measured from API call to next loop tick rejecting).

## 7. Scope by phase

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for ticket-level breakdown. High-level:

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 — Scaffold | Monorepo, config, DB schema, logger, test harness, stub adapters | `pnpm typecheck && pnpm test` green |
| 2 — Paper | Public market data, features, AI context, strategy, risk, paper broker, persistence | `pnpm paper:once` produces a full audit chain in DB |
| 3 — Sandbox | Coinbase auth, REST client, sandbox preview/create/cancel/list | Sandbox integration tests pass; schema validators agree with live response shape |
| 4 — Live read-only | Live REST reads, WebSocket subscriptions, shadow-mode strategy run | 1 week of shadow operation with 0 reconciliation drift |
| 5 — Live micro-orders | Trade-capable credentials in execution worker, tiny notional, alerting | 30 days of stable operation at bootstrap notional before any limit increase |

## 8. Key design decisions

1. **Deterministic engine is final authority.** Reaffirmed from architecture doc §"Key design decision". The LLM is advisory only.
2. **Coinbase first, adapter pattern preserved.** Other exchanges are explicitly out of scope for v1 but the `packages/coinbase/` module exposes an interface (`ExchangeClient`) that future adapters can implement.
3. **Paper mode is not optional.** Even in live mode, every strategy run is also simulated by the paper broker in parallel so shadow PnL is always available for comparison.
4. **Sandbox is for shapes, not performance.** Per Coinbase docs, sandbox responses are mocked. We use it only to validate request/response contracts.
5. **Fail closed everywhere.** Missing config, schema mismatch, stale data, JWT failure → halt, never default-permit.

## 9. Open questions

- **Q1:** Which LLM provider for v1? (Recommend: Anthropic Claude via API for structured output reliability — defer until Phase 2 ticket.)
- **Q2:** Hosting target — local Mac, home server, or VPS? Affects always-on requirements and observability stack. (Recommend: local Docker Compose through Phase 3; cheap VPS for Phase 4+.)
- **Q3:** Alerting channel for live orders. (Recommend: Pushover or SMS for hard alerts; Slack/Discord for informational. Wire in Phase 5.)

## 10. Related documents

- [autonomous_crypto_trading_agent_architecture.md](./autonomous_crypto_trading_agent_architecture.md) — full technical architecture
- [TECH_SPEC.md](./TECH_SPEC.md) — module interfaces and data contracts
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — phased tickets for Claude Code
- [CLAUDE.md](./CLAUDE.md) — Claude Code working guidelines for this repo
- [RISK_POLICY.md](./RISK_POLICY.md) — hard limits and promotion path
- [RUNBOOK.md](./RUNBOOK.md) — operational commands
- [LIVE_TRADING_CHECKLIST.md](./LIVE_TRADING_CHECKLIST.md) — pre-live gates
