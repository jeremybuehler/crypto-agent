# Crypto Guy Security and Privacy Model

## Scope and deployment assumption

Crypto Guy is initially a single-user, local-first financial system. The browser, API, worker, Postgres, Redis, model provider, Coinbase, and optional alert webhook are separate trust zones even when deployed on one host. Loopback is preferred for local use. Any non-loopback deployment requires TLS at the ingress, explicit allowed origins, and protected private networking for Postgres and Redis.

The model is advisory. It has no exchange credential, order, approval, database, shell, or network tool. Deterministic services remain authoritative for validation, risk, approval, and execution.

## Protected assets

- Coinbase key name, private key, request JWTs, operator token, internal worker token, database/Redis credentials, model-provider key, webhook secret.
- Account balances, holdings, fills, order history, profile facts, financial goals/constraints, advice history, educational progress, learned outcomes, approvals, and audit records.
- Risk limits, pause/kill state, proposal digests, idempotency keys, reconciliation state, worker heartbeats, backups, and deployment configuration.

## Trust boundaries and authentication

| Boundary | Authentication | Authority |
|---|---|---|
| Browser → dashboard server | Local session/ingress policy | Render and request operator workflows |
| Dashboard server → operator API | `OPERATOR_API_TOKEN` bearer | Read operator data and request audited operator actions |
| Worker → internal API | distinct `INTERNAL_API_TOKEN` bearer | Ingest heartbeat and validated internal events only |
| API/worker → Postgres | private connection, least-privilege role | Durable authoritative state |
| API/worker → Redis | private connection, authenticated when remote | Ephemeral operational coordination |
| Worker → Coinbase | request-scoped 120-second JWT | Exact configured view/trade permissions |
| AI service → model provider | provider key held server-side | Strict structured context/advice requests only |

Only liveness is unauthenticated. Readiness contains no secrets or account data. Operator and internal tokens must be different, at least 32 random bytes, rotated manually for the single-user deployment, and never accepted in query strings.

## Untrusted input and prompt injection

User text, model output, webpages, market/news sources, exchange responses, emails, imported files, logs, database values, and all tool output are untrusted. They may supply evidence but cannot grant authority, change permissions, approve proposals, alter risk limits, or instruct the system to reveal data.

All boundaries use strict Zod schemas with size/count limits. Unknown keys are rejected. External markup is rendered as text unless a dedicated sanitizer and allowlist are present. Returned code is never executed. Prompts are built from field allowlists; secrets and raw tool payloads are prohibited. Injection attempts are recorded as sanitized audit classifications and regression evals, not copied verbatim into general logs.

## Financial side-effect controls

1. Strategy creates an immutable proposal.
2. Deterministic risk evaluates the exact intent.
3. Coinbase preview validates the exact order when required.
4. The operator accepts the exact digest before expiry.
5. Execution consumes approval once under an idempotency key and lock.
6. Reconciliation validates exchange/local state and triggers the kill switch on material drift.

Approval for advice, education progress, or a learned change never authorizes an order. Any mutation to product, side, amount, preview, fee, expiry, or policy invalidates order approval. Pause/kill and daily-loss checks run again immediately before execution.

## Data classification, retention, and user control

| Class | Examples | Logging | Retention/control |
|---|---|---|---|
| Secret | tokens, private keys, JWTs, credentials | Never | Secret manager/environment; rotate and revoke |
| Sensitive financial/profile | balances, goals, constraints, advice | Metadata only, redacted | Durable only when required; view/export/correct/delete |
| Audit | proposal digest, decision, actor, outcome | Structured IDs and safe metadata | Append-only per documented retention |
| Operational | latency, status, error code, counts | Structured and sampled | Time-bounded telemetry |
| Public/reference | product IDs, cited public sources | Allowed | Source/version retention |

Durable memories require scope, provenance, confidence, timestamps, version, and retention metadata. Crypto Guy never stores credentials or raw exchange/model/tool responses as memory. Deletion is audited and implemented as immediate access suppression followed by transactional erasure according to retention obligations. Backups inherit the same classification and deletion/expiry policy.

## Logging and diagnostics

Logs carry request/loop correlation IDs, stable error codes, duration, dependency name, model/provider metadata, guardrail decision, and outcome. Redaction covers authorization, cookies, token/key/password/secret fields, connection URLs, profile values, prompts, model/tool payloads, and request bodies by default. Unknown errors return a generic message; detailed causes remain in redacted server diagnostics.

No endpoint returns stack traces, dependency credentials, SQL, private hostnames, provider response bodies, or Coinbase error bodies. Alerts contain identifiers and safe summaries, never secrets or full financial/profile payloads.

## Threats and required mitigations

- **Stolen operator token:** TLS/loopback, high entropy, rotation, rate limits, audit, no browser bundle exposure.
- **Internal route spoofing:** distinct secret, network isolation, strict schemas, idempotency, replay detection.
- **CSRF/CORS abuse:** bearer auth server-side, explicit origins, no credentialed wildcard CORS, security headers.
- **Prompt/tool injection:** instruction hierarchy, field allowlists, inert rendering, source provenance, behavioral evals.
- **Approval replay/substitution:** exact digest, expiry, one-time consumption, transaction/lock, immutable audit.
- **Risk bypass:** single execution boundary, property tests, pre-execution recheck, kill switch, code review gate.
- **Dependency timeout/partial failure:** bounded timeout, safe retries only, circuit breakers, degraded state, no optimistic success.
- **Database race/restart:** transactions, unique idempotency keys, optimistic versions, migration locks, restart tests.
- **Reconciliation drift:** scheduled account/order/fill comparison, threshold, halt, alert, operator review.
- **Supply-chain compromise:** frozen lockfile, minimal dependencies, CI audit/SBOM/image scan before release.
- **Backup theft/loss:** encryption, restricted access, checksums, restore drills, retention and rotation.
- **Unsafe advice:** confirmed profile facts, fresh sources, explicit assumptions/uncertainty/alternatives, no execution authority, U.S.-only module initially.

## Incident response

Activate the kill switch, pause the worker, cancel open orders if the verified execution service is available, revoke Coinbase credentials, rotate operator/internal/provider/webhook secrets, preserve sanitized audit evidence, reconcile accounts/orders/fills, restore from a verified backup only if needed, and document root cause. Live mode remains disabled until preflight, reconciliation, alerts, and credential scope are reverified.

Security issues must add a regression test or behavioral eval. Safety rules may be strengthened without approval but may not be weakened merely to restore availability.
