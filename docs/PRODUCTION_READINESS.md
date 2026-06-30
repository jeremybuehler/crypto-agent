# Crypto Guy — Production Readiness Evidence

This matrix maps each production-readiness requirement to the code and the
verification that backs it. It is intentionally honest about what is verified in
this environment versus what is gated on external resources (Coinbase
credentials, a Docker daemon, a live LLM key).

**Verification commands:** `pnpm typecheck`, `pnpm test:core` (hermetic),
`pnpm test:integration` (embedded pglite — no Docker), `pnpm test` (all).
As of this writing: **195 tests pass, typecheck clean.**

## Task status

| Task | Scope | Status | Evidence |
|------|-------|--------|----------|
| T6.1 | Threat model + API contracts | ✅ done | `apps/api/src/contracts.ts`, `errors.ts`, `docs/SECURITY.md`, `tests/api-contracts.test.ts` |
| T6.2 | Authenticated, hardened API boundary | ✅ done | `apps/api/src/auth.ts`, `plugins/security.ts`, `tests/api-security.test.ts` |
| T6.3 | Durable transactional operator + audit state | ✅ done, verified live | migrations `002`, `operator-repository.ts`, `tests/operator-persistence.test.ts`, `tests/integration/api-persistence.test.ts` |
| T6.4 | Health, heartbeats, metrics, alerts | ✅ done, verified live | `core/telemetry.ts`, `core/alerts.ts`, `routes/health.ts`, `routes/metrics.ts`, `tests/observability.test.ts` |
| T6.5 | Interactive proposal approvals | ✅ done, verified live | `execution/proposals.ts`, migration `003`, `routes/proposals.ts`, `tests/proposals*.test.ts`, dashboard ProposalsPanel |
| T6.6 | Coinbase execution + reconciliation | ✅ core done (mocked) | `coinbase/schemas.ts`, `coinbase/order-client.ts`, `execution/reconciliation.ts`, `tests/coinbase-execution.test.ts`, `tests/reconciliation.test.ts` |
| T6.7 | Inspectable always-learning memory | ✅ done, verified live | migration `004`, `learning-memory.ts`, `routes/learning.ts`, `tests/learning.test.ts`, `tests/integration/api-learning.test.ts` |
| T6.8 | Sourced advice, no execution authority | ✅ done, verified live | `ai/advice.ts`, migration `005`, `routes/advice.ts`, `tests/advice.test.ts`, `tests/integration/api-advice.test.ts` |
| T6.9 | Deployment, recovery, live preflight | ✅ artifacts + preflight done | `Dockerfile`, `infra/compose.production.yml`, `scripts/{live-preflight,backup,restore-verify}.ts`, `tests/deployment.test.ts` |
| T6.10 | Completion audit + evidence | ✅ this doc + goldens + CI | `docs/PRODUCTION_READINESS.md`, `evals/production-goldens.jsonl`, `.github/workflows/ci.yml` |

## Safety invariants → evidence

| Invariant (CLAUDE.md) | Evidence |
|------|----------|
| Risk may veto; operator authorizes live execution | proposal digest approval one-time/expiring — `tests/proposals.test.ts`, `tests/integration/api-proposals.test.ts` |
| LLM never emits orders | advice is data-only with no execution affordance — `tests/advice.test.ts` |
| Fail closed | readiness 503 when down, reconciliation breach trips kill switch, preflight non-zero — `tests/observability.test.ts`, `tests/reconciliation.test.ts`, `tests/deployment.test.ts` |
| No secrets stored | `assertNoSecret` rejects credential-like keys/values — `tests/learning.test.ts` |
| Live mode gated | `evaluateLivePreflight` cannot self-acknowledge or bypass — `tests/deployment.test.ts` |
| Metrics from realized outcomes, never BUY count | average-cost fold — `tests/operator-persistence.test.ts` |
| Zod everything external | Coinbase response schemas — `tests/coinbase-execution.test.ts` |
| External content is untrusted | advice injection-resistant; learning observations are pending, not facts — `tests/advice.test.ts`, `tests/integration/api-learning.test.ts` |

Behavioral goldens for these are enumerated in `evals/production-goldens.jsonl`.

## Verified live (real Postgres + Redis, paper mode)

Dogfooded end-to-end against a local Postgres 16 + Redis 7 with the dashboard:

- Worker → API → Postgres → dashboard: durable portfolio, trades, and metrics
  derived from fills survive an API restart.
- `/health/ready` reports per-dependency health; `/metrics/prom` serves real
  numbers behind operator auth; engaging the kill switch emits a critical alert.
- Interactive approval: worker proposes → dashboard shows pending → operator
  approves with the exact digest → replay returns 409 → audit logs both events.
- Learning: operator fact + worker pending insight, version-conflict on stale
  correction, secret rejected (400).
- Advice: US-only, disclaimer-bearing, sourced; unsafe request refused (400).
- `pnpm live:preflight` fails closed in paper mode (exit 1).

## Not exercisable in this environment (gated, by design)

These are implemented to the plan's "mocked tests always" boundary; the live
portions require resources absent here and remain blocked until externally
verified:

- **Live Coinbase sandbox** (T6.6): typed client + schemas are tested with
  mocked responses; real preview/create/cancel/reconcile require Coinbase
  Advanced Trade credentials.
- **Container smoke + restore drill** (T6.9): Dockerfile + compose + backup +
  restore-verify are written and the preflight is tested, but no Docker daemon
  is available to build/run the stack here.
- **Live LLM advice** (T6.8): the conservative deterministic provider is fully
  tested; swapping in a Claude-backed provider requires `ANTHROPIC_API_KEY`.

Live release stays blocked until operator credentials, alert delivery, a
read-only reconciliation pass, and an explicit acknowledgement are externally
verified via `pnpm live:preflight`.
