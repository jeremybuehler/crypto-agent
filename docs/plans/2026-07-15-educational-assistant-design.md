# Educational Assistant ("the coworker pane") — v1 Design

**Status:** Approved (operator, 2026-07-15)
**Date:** 2026-07-15
**Parent design:** [2026-06-19-crypto-guy-education-learning-design.md](./2026-06-19-crypto-guy-education-learning-design.md) — this is its first implemented slice.

## Outcome

A slide-out AI assistant on the dashboard that explains what the system is doing and teaches trading concepts, grounded in the operator's *actual* trades rather than generic content. Two learners with different depth needs (the operator — technical, learning trading and the platform simultaneously — and a beginner family member) use the same tools at different levels.

The assistant explains and quizzes. It never trades, approves, pauses, or changes configuration — education has no execution authority (CLAUDE.md rule #10), enforced at the tool level: the assistant's tool belt is read-only against the audit chain and market data.

## Why a coworker pane, not seven dashboard features

Seven candidate education features (why-panel, glossary, journal, report cards, chart overlays, quiz mode, backtest what-ifs) collapse into one assistant with a tool belt. The features become capabilities the assistant reaches for in conversation; the UI stays one pane plus contextual "explain this" buttons. This mirrors the FieldNative/Felix architecture: tool-parity coworker, server-side tool router, humans approve anything consequential.

## v1 scope

**Pane:** slide-out chat on the dashboard. Learner profile selector (operator / beginner) that changes explanation depth, not capability. Persistent disclaimer: explains mechanics and history; does not give investment advice.

**"Explain this" buttons** on every trade in the feed, every proposal in the approval queue, and every risk rejection — opens the pane pre-loaded with that item's correlation id. The learner clicks the confusing thing instead of formulating a question.

**Tools (v1, all read-only):**
- `explain_trade(correlationId)` — the full causal chain from the audit trail: market snapshot, feature values (EMAs, MACD, volatility, spread), AI context, strategy intent + rationale, every risk rule with pass/fail and current-vs-limit, fill economics.
- `define_term(term)` — canonical glossary entry: definition, why it matters here, one reputable reference link (Investopedia / Coinbase Learn / Babypips). Static TypeScript map so definitions are consistent across conversations.
- `build_report_card(productId)` — most recent closed round trip: PnL decomposed into price move vs fees, entry/exit reasons, and the no-trade counterfactual.
- `get_portfolio_state()` — current portfolio, risk config, and mode, so answers reflect reality.

**LLM path:** server-side only (operator API), Anthropic SDK tool-use loop, responses Zod-validated. Without `ANTHROPIC_API_KEY`, a deterministic fallback answers `explain this` requests directly from the tool data (structured, un-narrated) and says how to enable the full assistant — the pane is useful, never broken (parent design: "model or schema failure yields deterministic education").

## Learner model (multi-user seam)

The operator wants distinct learner experiences today (himself and his son Hunter, each with their own view) and a possible multi-tenant product later. v1 therefore models the learner as a first-class entity — `{ id, name, level: beginner | intermediate | advanced }` — carried on every assistant request and used to key journal/calibration data in v2. The pane's profile picker is client-side for now (no accounts); when real auth arrives (house standard: Clerk), the learner id becomes the authenticated user id and nothing downstream changes shape.

**Productization caveat (explicitly out of scope here):** the platform is single-operator by design (PRD core scope: one operator, one exchange account, one kill switch). Multi-tenant SaaS means accounts/auth, per-user data partitioning, per-user risk policy, and — if third-party funds are ever involved — a regulatory workstream (KYC/licensing) that precedes any code. That is its own future design doc; v1 builds the learner seam only.

## Deferred (v2+)

Journal tool + weekly calibration review (parent design's decision journal), quiz behavior, chart-overlay series tool, bounded `run_backtest` tool, education-profile persistence (T2.9), adaptive level from demonstrated understanding rather than a manual selector (T2.10), profile-aware advice (T2.11), multi-user auth + tenancy (see Learner model above).

## Safety and failure behavior

- Tool belt is read-only; no tool can reach `/ops/*`, proposals decisions, execution, strategy, or risk config. New tools must justify any write (v2 journal writes only to its own table).
- No secrets in prompts (CLAUDE.md rule #4): grounding context is trade economics, indicator values, and rationale text only — never keys, tokens, account identifiers.
- Assistant output is conversation only. Nothing it says mutates system state; nothing it reads is treated as instructions (external content is untrusted evidence).
- Model failure, schema mismatch, or missing key → deterministic fallback, never an error wall.
- Prompt injection stance: tool results (market data, rationale text) are data. The system prompt instructs the model to treat them as evidence, and the tool router validates all tool inputs (correlation ids are UUIDs, terms come from the glossary key set).

## Architecture

```
dashboard ChatPane ──POST /api/assistant──▶ Next server route (adds operator token)
                                              │
                                              ▼
                              operator API  POST /assistant/ask   (requireOp)
                                              │
                                    assistant service (apps/api)
                                    ├─ system prompt (learner profile, layers:
                                    │   Learn / Analyze — per parent design)
                                    ├─ Anthropic tool-use loop (@agent/ai)
                                    │   └─ stub fallback without API key
                                    └─ tools → @agent/persistence read methods
                                               + static glossary (@agent/ai)
```

New persistence read method: `getTradeStory(correlationId)` joining market_snapshots, feature_snapshots, ai_contexts, trade_intents, risk_decisions, proposals, real_fills/paper_fills on correlation id. Report card reuses `computeRealizedMetrics` (average-cost basis) over recent fills.

## Testing

- pglite-backed tests for `getTradeStory` and report-card data (seeded audit chain → complete story; missing links → partial story with explicit gaps, never a throw).
- Glossary: every entry has definition + why-it-matters + link; lookup is case/whitespace-insensitive.
- Assistant service with stubbed provider: tool router validates inputs, rejects unknown tools, read-only invariant (no tool touches a write repository method — enforced by constructor wiring, asserted in tests).
- API route: operator auth required, request/response schemas validated, fallback path returns structured education without a key.
- UI: pane renders loading/empty/error/fallback states; explain-this buttons pass the correlation id.
