# Crypto Guy Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Crypto Guy into a secure, durable, interactive, observable, deployable single-user crypto education, advice, proposal, and trading system with verified paper/sandbox/live safety boundaries.

**Architecture:** Fastify is split into typed route modules backed by Postgres repositories and Redis operational state. The worker creates auditable proposals and executes only exact, unexpired, one-time approvals through a typed Coinbase execution service. AI education/advice/learning services emit strict, source-attributed objects and cannot call execution tools.

**Tech Stack:** TypeScript, Fastify, Zod, PostgreSQL, Redis, Pino, Prometheus/OpenTelemetry-compatible telemetry, Coinbase Advanced Trade, Anthropic structured tool output, Next.js, SWR, Vitest, fast-check, Playwright, Docker Compose.

---

### Task 1: Freeze production threat model and API contracts

**Files:**
- Create: `docs/SECURITY.md`
- Create: `apps/api/src/contracts.ts`
- Create: `apps/api/src/errors.ts`
- Test: `tests/api-contracts.test.ts`

1. Write failing tests for strict operator/internal auth headers, error envelopes, request IDs, capability discovery, health details, profile memory, advice, proposal, approval, cancellation, and audit contracts.
2. Run `pnpm test:core -- tests/api-contracts.test.ts` and verify failures are caused by missing contracts.
3. Implement strict Zod schemas, stable error taxonomy, and sanitized diagnostics.
4. Document assets, trust boundaries, injection paths, data classes, retention, abuse cases, and live-trading failure modes.
5. Run focused tests, typecheck, and commit `T6.1: define production security and API contracts`.

### Task 2: Authenticate and harden every API boundary

**Files:**
- Create: `apps/api/src/auth.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/plugins/security.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `tests/api-security.test.ts`

1. Write failing injection/security tests for missing/wrong tokens, internal-route isolation, CORS rejection, oversized payloads, malformed JSON, rate limits, correlation IDs, and redacted logs.
2. Add `OPERATOR_API_TOKEN`, `INTERNAL_API_TOKEN`, `ALLOWED_ORIGINS`, proxy/TLS policy, and production entropy validation without logging values.
3. Require operator auth on all data/operation routes and distinct internal auth on worker ingestion/heartbeat routes; keep only liveness unauthenticated.
4. Add body limits, explicit CORS, security headers, bounded timeouts, rate limits, stable error handling, and request/audit IDs.
5. Update dashboard server-side proxy authentication so secrets never enter browser JavaScript.
6. Run security tests, dashboard E2E, typecheck, and commit `T6.2: harden operator and worker API boundaries`.

### Task 3: Replace process memory with durable transactional state

**Files:**
- Create: `packages/persistence/migrations/002_operator_state.sql`
- Create: `packages/persistence/src/operator-repository.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `tests/operator-persistence.test.ts`
- Test: `tests/integration/api-persistence.test.ts`

1. Write failing repository/integration tests for portfolio snapshots, fills, realized PnL, fees, win/loss semantics, heartbeats, idempotent ingestion, concurrency, and restart recovery.
2. Add migrations with constraints, indexes, version columns, retention timestamps, and immutable audit events.
3. Implement transactional repositories and remove API trade rings/default portfolio state.
4. Make worker ingestion authenticated, schema-validated, idempotent, timed out, retried with backoff, and visibly failed rather than swallowed.
5. Derive metrics from durable fills and realized outcomes, never BUY count.
6. Run migration/restart/failure tests and commit `T6.3: persist operator and audit state`.

### Task 4: Implement health, heartbeats, metrics, traces, and alerts

**Files:**
- Create: `packages/core/src/telemetry.ts`
- Create: `packages/core/src/alerts.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/metrics.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `tests/observability.test.ts`

1. Write failing tests for shallow liveness vs dependency readiness, stale worker heartbeat, DB/Redis/Coinbase status, Prometheus output, correlation propagation, PII redaction, and alert delivery failure.
2. Implement structured spans/metrics and health components with bounded dependency checks.
3. Add stdout and authenticated webhook alert adapters with retry/idempotency for kill switch, daily-loss halt, reconciliation drift, and live order lifecycle.
4. Add dashboard/runbook metric definitions: success/tool-error rate, p50/p95, cost/task, guardrail rate, proposal outcomes, reconciliation drift, and eval pass rate.
5. Run tests and commit `T6.4: add production observability and alerts`.

### Task 5: Build exact proposals and non-transferable approvals

**Files:**
- Create: `packages/execution/src/proposals.ts`
- Create: `packages/persistence/migrations/003_proposals.sql`
- Create: `apps/api/src/routes/proposals.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/dashboard/src/features/proposals/*`
- Test: `tests/proposals.test.ts`
- Test: `apps/dashboard/src/features/proposals/proposals.test.tsx`

1. Write failing tests for exact payload digests, expiry, replay, changed previews, duplicate approvals, rejection, pause/kill interaction, and distinct learned-change approvals.
2. Persist immutable proposals and one-time approval/rejection events transactionally.
3. Change worker output from immediate paper fill to proposal when interactive approval is required; preserve a clearly labeled simulation-only auto-fill mode for tests/backtests.
4. Expose validated list/inspect/accept/reject routes and premium dashboard review UI.
5. Run unit/property/integration/browser tests and commit `T6.5: add interactive proposal approvals`.

### Task 6: Complete Coinbase preview, execution, cancellation, and reconciliation

**Files:**
- Create: `packages/coinbase/src/schemas.ts`
- Create: `packages/execution/src/coinbase-execution.ts`
- Create: `packages/execution/src/reconciliation.ts`
- Create: `apps/api/src/routes/orders.ts`
- Test: `tests/coinbase-execution.test.ts`
- Test: `tests/reconciliation.property.test.ts`
- Test: `tests/integration/coinbase-sandbox.test.ts`

1. Write failing tests for strict untrusted response parsing, request-scoped JWTs, preview-before-create, client-order idempotency, timeout/5xx/malformed response handling, cancellation allowlist, partial cancellation, and reconciliation drift circuit breaking.
2. Add typed preview/create/cancel/list/fills/account methods with redacted errors, timeouts, and safe retries.
3. Require persisted intent, risk approval, exact preview, valid user approval, and execution lock before create-order.
4. Implement cancel-open-orders and scheduled account/order/fill reconciliation; drift activates kill switch and alerts.
5. Keep live execution behind preflight; run mocked tests always and sandbox tests only with explicit credentials.
6. Commit `T6.6: complete safe Coinbase execution lifecycle`.

### Task 7: Implement inspectable always-learning memory and education

**Files:**
- Create: `packages/learning/src/index.ts`
- Create: `packages/persistence/migrations/004_learning.sql`
- Create: `apps/api/src/routes/learning.ts`
- Modify: `apps/dashboard/src/features/education/*`
- Modify: `apps/dashboard/src/features/profile/*`
- Test: `tests/learning.test.ts`
- Test: `tests/learning-injection.eval.ts`

1. Write failing tests for provenance, confidence, scope, TTL, consent, optimistic concurrency, view/correct/export/delete, secret rejection, prompt injection, and separation of observation from learned-change proposal.
2. Add durable memory/profile/lesson records and audit history; prohibit secret fields and raw tool output.
3. Implement Learn/Analyze curriculum endpoints with versioned source metadata and knowledge checks.
4. Implement user controls and enable capabilities only after validated APIs respond.
5. Add hostile-content behavioral evals and commit `T6.7: add inspectable learning and education`.

### Task 8: Implement U.S.-first personalized advice without execution authority

**Files:**
- Create: `packages/advice/src/index.ts`
- Create: `packages/persistence/migrations/005_advice.sql`
- Create: `apps/api/src/routes/advice.ts`
- Modify: `apps/dashboard/src/features/advice/*`
- Test: `tests/advice.test.ts`
- Test: `tests/advice-safety.eval.ts`

1. Write failing tests for confirmed profile prerequisites, jurisdiction, source freshness, assumptions, alternatives, uncertainty, loss/tax/legal disclaimers, unsafe requests, injection, and proof that advice cannot invoke execution.
2. Implement strict advice inputs/outputs and a model provider with source/profile allowlists, timeouts, cost metadata, and conservative fallback.
3. Persist advice provenance and user feedback separately from trade approval.
4. Add dashboard advice review and profile-fact provenance; keep non-U.S. jurisdictions disabled pending policy modules.
5. Run safety evals/browser tests and commit `T6.8: add sourced personalized advice`.

### Task 9: Production deployment, backup, recovery, and live preflight

**Files:**
- Create: `Dockerfile`
- Create: `infra/compose.production.yml`
- Create: `scripts/backup.ts`
- Create: `scripts/restore-verify.ts`
- Create: `scripts/live-preflight.ts`
- Modify: `.env.example`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/LIVE_TRADING_CHECKLIST.md`
- Test: `tests/deployment.test.ts`

1. Write failing tests for non-root containers, read-only filesystem, health checks, graceful shutdown, migration locking, backup/restore checksum, missing secrets, scoped-key acknowledgement, alert test, reconciliation pass, and paper/sandbox evidence.
2. Add reproducible multi-stage images and least-privilege production composition with Postgres/Redis persistence.
3. Add encrypted backup guidance, restore verification, rollback, key rotation, incident response, and retention procedures.
4. Implement machine-checkable live preflight that cannot set its own acknowledgements or bypass failures.
5. Run container smoke, restore drill, preflight negative tests, and commit `T6.9: add production deployment and recovery`.

### Task 10: Full completion audit and release evidence

**Files:**
- Create: `docs/PRODUCTION_READINESS.md`
- Create: `evals/*.jsonl`
- Modify: `docs/PRD.md`
- Modify: `docs/TECH_SPEC.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md`
- Modify: `.github/workflows/ci.yml`

1. Build a requirement-to-evidence matrix covering every PRD safety invariant, user requirement, API, dashboard state, memory control, advice boundary, operational command, and live gate.
2. Add deterministic behavioral goldens for tool selection, arguments, refusal, injection, stale sources, proposal approval, and tool failures.
3. Run clean install, unit/property/integration/eval/security/browser/visual/performance/container/migration/backup/restore suites.
4. Run paper soak and sandbox request-shape verification; record dates, versions, and artifacts without fabricating unavailable external evidence.
5. Keep live release blocked unless operator credentials, alerts, read-only reconciliation, and explicit acknowledgement are externally verified.
6. Commit `T6.10: publish production readiness evidence` only when the evidence matrix is truthful.

