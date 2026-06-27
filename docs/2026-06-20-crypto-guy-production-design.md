# Crypto Guy Production Design

## Decision

Crypto Guy will ship as a single-user, local-first system before any hosted or multi-user version. It will be interactive by default: the model may educate, analyze, advise, and draft proposals, but deterministic services own validation and risk, and the operator owns every approval that can create an exchange side effect. Live trading remains disabled until the technical preflight and the operator's external account/key setup both pass.

This is preferable to either a fully autonomous agent or a dashboard-only assistant. Full autonomy conflicts with the requested interaction model and creates unacceptable financial and operational risk. A dashboard-only assistant cannot satisfy durable learning, personalized guidance, reconciliation, or production execution requirements.

## Architecture

- **API/orchestrator:** Fastify modules for authenticated operator routes, internal worker routes, health, metrics, education, profile memory, advice, proposals, approvals, and operations.
- **State:** Postgres is authoritative for portfolios, fills, proposals, approvals, advice, learning records, audit events, and service heartbeats. Redis holds pause/kill/circuit-breaker state and short-lived coordination locks. No production read path depends on process memory.
- **Execution:** Coinbase is isolated behind typed preview/create/cancel/list interfaces. Every executable request carries an idempotency key, validated risk decision, exact preview, expiry, and one-time approval. Live execution fails closed.
- **AI:** Models produce strict structured objects only. External content and model output are untrusted, sanitized, source-attributed, and never directly executable.
- **UI:** The premium dashboard remains the operator boundary. Capability discovery comes from a validated API, so unavailable features cannot be enabled by frontend-only flags.

## Interactive proposal and approval model

Strategy output becomes a proposal, not an order. A proposal records the exact product, side, amount, estimated price/fees, strategy version, risk decision, evidence, and expiration. The user can accept or reject it. Approval is bound to the proposal digest and cannot transfer to another order or to a learned configuration change. Any change after preview invalidates approval.

Pause and kill activation remain available during noncritical failures. Resume, kill clearing, cancellation, advice acceptance, memory deletion, and execution require current authenticated state. Live kill clearing requires a separate operational preflight and is never a routine dashboard action.

## Learning, education, and personalized advice

Learning is explicit and inspectable. Crypto Guy stores only user-confirmed facts, preferences, educational progress, outcome summaries, and proposed strategy/configuration changes. Each memory has scope, source, confidence, created/updated timestamps, retention policy, and deletion state. Secrets, raw exchange payloads, and hidden behavioral profiles are prohibited. Users can view, correct, export, and delete durable memory.

Education follows **Learn → Analyze → Advise**:

1. Learn explains concepts, mechanics, costs, and risks with versioned sources.
2. Analyze applies those concepts to validated market/account evidence and states uncertainty.
3. Advise relates alternatives to the user's confirmed goals and constraints.

Advice is U.S.-first and intended for the owner's personal use. Every response identifies jurisdiction, source timestamps, profile facts used, assumptions, risks, alternatives, and confidence. Advice cannot approve or place a trade. Public or multi-user distribution requires separate legal/compliance review; the system must not imply registration, fiduciary status, guaranteed returns, or tax/legal authority.

## Security and privacy

- Operator routes require a high-entropy bearer token over TLS or loopback. Internal worker routes use a distinct secret.
- CORS is an explicit allowlist. State-changing routes are rate-limited and audited with correlation/request IDs.
- Inputs and outputs use strict Zod schemas; tool/network output is never executed or treated as instruction.
- Logs redact credentials, authorization, cookies, PII, profile contents, and raw model/tool payloads.
- Memory defaults to durable local storage with user-controlled export/delete; retention is documented per record type.
- Coinbase JWTs remain request-scoped, short-lived, unlogged, and unpersisted.

## Reliability and observability

Network tools have bounded timeouts, retry only safe/idempotent operations, exponential backoff, and circuit breaking. Writes use idempotency keys and database transactions. Shared state uses optimistic concurrency or advisory locks. Error taxonomy separates validation, authentication, conflict, dependency, timeout, and internal faults.

Structured telemetry includes request/loop correlation IDs, model metadata, tool duration/status, guardrail decisions, proposal/approval lifecycle events, and redaction decisions. Prometheus metrics cover success rate, tool failures, p50/p95 latency, model cost, refusal/guardrail rate, proposal outcomes, reconciliation drift, heartbeat age, and eval pass rate.

## Verification and release

Unit, property, integration, behavioral-eval, security-rendering, browser, accessibility, performance, migration, backup/restore, and failure-injection suites are release gates. Production packaging includes containers, health checks, migrations, secret/environment documentation, least-privilege deployment, backups, and rollback. A live release additionally requires sandbox request-shape verification, read-only reconciliation, scoped Coinbase credentials, configured alerts, manual preflight, and explicit operator acknowledgement.

