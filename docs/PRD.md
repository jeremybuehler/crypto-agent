# PRD: Crypto Guy v1

**Status:** Draft for implementation
**Owner:** Jeremy Buehler
**Last updated:** 2026-06-18
**Source of truth (technical):** [crypto-guy-architecture.md](./crypto-guy-architecture.md)

---

## 1. Problem and opportunity

Manual crypto trading is reactive, emotional, and bounded by attention. Existing retail bots either (a) hand the LLM full execution authority (unsafe) or (b) are pure deterministic rule engines that ignore the contextual reasoning LLMs are good at.

Crypto Guy is a safety-first interactive trading platform. An LLM provides structured market context that deterministic strategy code can use or ignore; deterministic risk code may veto any proposal; and an operator must explicitly approve every strategy-generated live order after preview. The system must be observable enough that every live order is fully reconstructable from persisted inputs and an attributable approval.

## 2. Goals

- **G1 — Capital preservation first.** No order ever bypasses the risk engine or live operator approval. Default mode is paper. Live mode requires explicit acknowledgement and tiny notional limits.
- **G2 — Explainable trades.** Every live order traces back to: market snapshot → features → AI context → strategy intent → risk decision → preview → operator approval → execution → fill.
- **G3 — Interactive operator control.** The operator can review, approve, or reject each live proposal. Kill switch, pause, resume, and cancel-open-orders remain immediately available.
- **G4 — Promotion path.** Paper → sandbox shape tests → live read-only shadow → live micro-orders. Each phase has clear exit criteria before the next is unlocked.
- **G5 — Built for solo operation.** Single user, local-first, minimal auth. Optimize for safety and observability, not multi-tenancy.
- **G6 — Teach continuously.** Explain what crypto-trading concepts mean, how mechanisms work, why they matter, and how to apply them safely at the operator's demonstrated knowledge level.
- **G7 — Explain and personalize.** Every analysis or recommendation distinguishes facts, estimates, assumptions, risks, alternatives, and the operator-profile facts that influenced it.
- **G8 — Learn under operator control.** Continuously learn from explicit facts, interactions, decisions, and outcomes while keeping inferences reviewable and requiring approval for every learned strategy or risk change.
- **G9 — Top-tier operator experience.** Deliver a polished, fast, accessible, responsive UI with clear hierarchy, progressive disclosure, complete system-state visibility, and deliberate safety interactions.

## 3. Non-goals (v1)

- No discretionary LLM trading (LLM cannot emit executable orders).
- No leverage, no perpetual futures, no shorting.
- No multi-exchange. Coinbase Advanced Trade only. Adapter pattern preserved for later.
- No unattended live execution. Starting live mode is not standing approval; each strategy-generated order requires a separate operator decision.
- No mobile app, no public dashboard, no multi-user RBAC.
- No guarantee of profit, certainty, suitability, or loss prevention.
- No silent modification of strategy logic, risk limits, enabled assets, position sizing, or execution authority.
- No public personalized-advice product in v1. U.S.-first personal use is the initial scope; public or international release requires jurisdiction-specific legal and compliance review.

## 4. Target user

**Primary persona — Jeremy (solo operator/developer).**
- Comfortable with TypeScript, Postgres, Docker, and CLI workflows.
- Wants the system running on a small always-on VPS or local machine.
- Will operate the agent through the local dashboard or API plus persisted audit records; no public or multi-user UI is required.
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
| U8 | Review a live trade before submission | The operator sees intent, rationale, risk results, preview, fees/slippage, and expiry; approval is single-use and bound to the exact preview. |
| U9 | Reject or ignore a proposal safely | Rejection records actor and reason; expiry results in no submission and requires a fresh preview. |
| U10 | Learn crypto trading concepts | Explanations cover what, how, why, risks, examples, and a short comprehension check at my current knowledge level. |
| U11 | Understand a recommendation | The response shows evidence, reasoning, assumptions, contrary signals, confidence, downside scenarios, alternatives, and why it may be wrong. |
| U12 | Receive personalized guidance | Guidance identifies the approved profile facts and derived insights that affected it and shows the profile version used. |
| U13 | Control what Crypto Guy learns | I can inspect, correct, accept, reject, export, and delete profile facts and derived insights. |
| U14 | Approve learned behavioral changes | Strategy and risk changes remain proposals until I explicitly approve them; rejection leaves current behavior unchanged. |
| U15 | Operate confidently through the dashboard | Every screen clearly communicates current mode, data freshness, risk state, pending actions, and loading/empty/stale/degraded/error states without requiring database access. |
| U16 | Learn without losing context | Educational explanations use progressive disclosure, plain-language definitions, examples, and links back to the relevant market data or proposal. |
| U17 | Use the interface accessibly | Core workflows work by keyboard, do not rely on color alone, support screen readers and reduced motion, and meet WCAG 2.2 AA targets. |

### System stories (acceptance criteria from architecture doc §"Risk controls" and §"Trading loop")

| ID | The system must... | Acceptance criteria |
|---|---|---|
| S1 | Never approve a trade that violates any hard limit | Property tests prove risk engine rejects when product not in allowlist, notional > max, daily loss breached, exposure > cap, mode = paper but order is live-bound, kill switch active. |
| S2 | Reconcile local state to Coinbase | Reconciliation job runs every N seconds; drift events ≥ configured threshold trigger circuit breaker. |
| S3 | Refuse to start if config is unsafe | Zod env validation fails fast with a clear error if any required live-mode variable is missing or out of range. |
| S4 | Generate short-lived JWTs per Coinbase request | No JWT lives longer than 120 seconds. No JWT is persisted or logged. |
| S5 | Never pass secrets to the LLM | Prompts are constructed from a whitelisted set of numeric/categorical fields. Static check + unit test enforce this. |
| S6 | Never submit a strategy-generated live order without current operator approval | Integration tests prove missing, expired, reused, mismatched, or already-rejected approvals fail closed before `createOrder`. |
| S7 | Preserve learning provenance | Every stored fact or inference records source, confidence, creation time, last-confirmed time, scope, and retention policy. |
| S8 | Keep learning separate from authority | Tests prove educational progress and learned inferences cannot mutate risk, strategy, or execution configuration directly. |
| S9 | Treat external content as untrusted | Market data, documents, LLM output, and tool output cannot create profile facts, approvals, or policy changes without validation and the required operator decision. |

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
- **M7:** 100% of strategy-generated live orders pass through preview and attributable operator approval before execution.
- **M8:** Every live order generates an alert within 10s.
- **M9:** Daily drawdown never exceeds `MAX_DAILY_LOSS_PCT`.
- **M10:** Kill switch activation halts new orders in < 1s (measured from API call to next loop tick rejecting).

### Education and learning
- **M11:** 100% of personalized recommendations record the profile version and supporting evidence used.
- **M12:** 100% of learned strategy/risk changes remain non-executable until explicitly approved.
- **M13:** Profile correction and deletion tests remove the item from future personalization.
- **M14:** Advice-calibration evals track confidence against outcomes without using profit alone as a quality label.

### UI/UX quality
- **M15:** Core operator workflows meet WCAG 2.2 AA automated checks and pass keyboard-only review.
- **M16:** Target Web Vitals are LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1 under the supported deployment profile.
- **M17:** Every data-dependent surface implements loading, empty, stale, degraded, error, and retry states.
- **M18:** Visual-regression and end-to-end tests cover dashboard, education, profile, advice, proposal review, approval, rejection, pause, and kill-switch flows.

## 7. Scope by phase

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for ticket-level breakdown. High-level:

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 — Scaffold | Monorepo, config, DB schema, logger, test harness, stub adapters | `pnpm typecheck && pnpm test` green |
| 2 — Paper | Public market data, features, AI context, strategy, risk, paper broker, persistence | `pnpm paper:once` produces a full audit chain in DB |
| 3 — Sandbox | Coinbase auth, REST client, sandbox preview/create/cancel/list | Sandbox integration tests pass; schema validators agree with live response shape |
| 4 — Live read-only | Live REST reads, WebSocket subscriptions, shadow-mode strategy run | 1 week of shadow operation with 0 reconciliation drift |
| 5 — Interactive live micro-orders | Trade-capable credentials in execution worker, mandatory per-order approval, tiny notional, alerting | 30 days of stable operation at bootstrap notional before any limit increase |

## 8. Key design decisions

1. **Risk is a veto; the operator authorizes execution.** The LLM is advisory only. Deterministic strategy and risk services can produce an eligible proposal, but only a valid operator approval can authorize live submission.
2. **Coinbase first, adapter pattern preserved.** Other exchanges are explicitly out of scope for v1 but the `packages/coinbase/` module exposes an interface (`ExchangeClient`) that future adapters can implement.
3. **Paper mode is not optional.** Even in live mode, every strategy run is also simulated by the paper broker in parallel so shadow PnL is always available for comparison.
4. **Sandbox is for shapes, not performance.** Per Coinbase docs, sandbox responses are mocked. We use it only to validate request/response contracts.
5. **Fail closed everywhere.** Missing config, schema mismatch, stale data, JWT failure → halt, never default-permit.
6. **Controlled continuous learning.** Education progress and factual observations may update automatically. Inferences remain reviewable. Behavioral changes require explicit approval and never inherit trade authority.
7. **Safety is part of UX.** The interface never hides stale data, weak confidence, risk failures, fees, slippage, expiry, or destructive consequences. Approval and rejection controls are visually distinct and never use dark patterns.

## 9. Open questions

- **Q1:** Hosting target — local Mac, home server, or VPS? Affects always-on requirements and observability stack. (Recommend: local Docker Compose through Phase 3; cheap VPS for Phase 4+.)
- **Q2:** Alerting channel for live orders and expiring proposals. (Recommend: Pushover or SMS for hard alerts; Slack/Discord for informational. Wire in Phase 5.)
- **Q3:** Retention periods for profile history, advice records, and outcome evidence before any live deployment.
- **Q4:** Jurisdictions and compliance controls required before offering personalized advice to anyone beyond the owner.

## 10. Related documents

- [crypto-guy-architecture.md](./crypto-guy-architecture.md) — full technical architecture
- [TECH_SPEC.md](./TECH_SPEC.md) — module interfaces and data contracts
- [INTERACTION_POLICY.md](./INTERACTION_POLICY.md) — live approval boundary and lifecycle
- [plans/2026-06-19-crypto-guy-education-learning-design.md](./plans/2026-06-19-crypto-guy-education-learning-design.md) — approved education and learning design
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — phased tickets for Claude Code
- [CLAUDE.md](./CLAUDE.md) — Claude Code working guidelines for this repo
- [RISK_POLICY.md](./RISK_POLICY.md) — hard limits and promotion path
- [RUNBOOK.md](./RUNBOOK.md) — operational commands
- [LIVE_TRADING_CHECKLIST.md](./LIVE_TRADING_CHECKLIST.md) — pre-live gates
