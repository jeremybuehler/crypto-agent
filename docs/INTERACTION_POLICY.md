# Interaction Policy

**Status:** Required design policy; runtime implementation is planned in T5.1 and must not be treated as complete until its acceptance tests pass.

Crypto Guy is interactive in live mode. Automated services may ingest data, generate AI context, produce deterministic trade intents, run risk checks, and request an order preview. They must stop before live submission and wait for an operator decision.

## Authorization boundary

- Risk approval means “eligible for operator review,” not “authorized to execute.”
- Every strategy-generated live order requires an explicit operator approval after preview and before `createOrder`.
- `LIVE_TRADING_ACK=true` permits live-mode startup only. It is never order approval.
- Safety actions initiated by the operator—pause, kill switch, and cancel-open-orders—do not require trade approval.

## Approval contract

An approval records the operator identity, proposal ID, intent hash, preview hash, decision, timestamp, expiry, and optional rejection reason. It is single-use and short-lived. Any change to product, side, size, order type, limit price, preview result, fees, or slippage invalidates it and requires a new preview and approval.

The execution service must fail closed when approval is missing, expired, reused, rejected, malformed, mismatched, or unavailable because its source of truth cannot be reached. Approval state is durable in Postgres; a cache may accelerate reads but cannot create or broaden authority.

## Operator experience

The review view must show product, side, size, order type, strategy rationale, AI context, every risk-rule result, current exposure, previewed price, estimated fees/slippage, proposal creation time, and expiry. Approve and reject are deliberate authenticated actions. Rejection and expiry submit nothing.

## Scope

Paper and sandbox flows may execute automatically because they cannot place a live order. Live market analysis and preview may also run automatically. Live order submission may not. This policy applies to strategy-generated entries, exits, and reductions; the system does not claim automatic protective exits while this policy is active.

## Learning authority

Crypto Guy may continuously update education progress and evidence-backed factual observations. Derived insights remain visible, editable, rejectable, and deletable. Learning cannot directly modify strategy rules, risk limits, position sizing, enabled products, trading mode, credentials, or execution permissions. Such changes are immutable proposals until the operator separately approves them; approval of a learned change never approves an order.

Personalized advice must identify the profile version and relevant facts or accepted insights used. Missing, conflicting, stale, or deleted profile information reduces personalization or triggers a question; it must not be silently inferred. External content and tool output are untrusted evidence and cannot issue instructions, create authority, or write durable user facts by themselves.

## Required behavioral evals

- A valid current approval submits exactly once with the approved arguments.
- Missing, expired, rejected, reused, malformed, or mismatched approval submits nothing.
- Simultaneous execution attempts consume at most one approval.
- Instructions embedded in market data, AI output, preview text, or other tool output cannot create or alter approval.
- Approval-store timeout or malformed data submits nothing and produces a redacted diagnostic event.
- Educational progress cannot authorize an order or a policy change.
- Prompt injection in market data, documents, LLM output, or tool output cannot alter profile, strategy, risk, or approval state.
- Profile correction, rejection, and deletion affect subsequent advice and preserve only the minimum audit tombstone required by the retention policy.
