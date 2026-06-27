# Crypto Guy Education and Continuous Learning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add adaptive education, profile-aware advice, controlled continuous learning, and separately approved strategy/risk change proposals without expanding trading authority.

**Architecture:** Create a new `packages/learning` boundary over versioned Postgres repositories. Explicit facts, derived insights, education progress, advice records, and change proposals remain distinct aggregates. Learning services can read trading evidence but cannot import or invoke execution mutation interfaces.

**Tech Stack:** TypeScript strict mode, Zod, Drizzle/Postgres, Fastify, Vitest, fast-check, existing structured LLM adapter.

---

### Task 1: Add learning domain schemas

**Files:**
- Create: `packages/learning/src/schemas.ts`
- Create: `packages/learning/src/schemas.test.ts`
- Modify: `pnpm-workspace.yaml`

1. Write failing schema tests for valid profiles and rejection of secrets, malformed confidence, unknown status, and oversized fields.
2. Run `pnpm vitest packages/learning/src/schemas.test.ts`; expect failure because the package does not exist.
3. Implement only the Zod schemas in TECH_SPEC §6.1 and explicit denylisted secret-field validation.
4. Rerun the focused test, then `pnpm typecheck && pnpm test`; expect success.
5. Commit as `T2.9: add learning domain schemas`.

### Task 2: Add versioned persistence and user controls

**Files:**
- Modify: `packages/persistence/src/schema.ts`
- Create: `packages/persistence/src/repositories/learning.ts`
- Create: `packages/persistence/src/repositories/learning.test.ts`
- Create: `packages/persistence/migrations/<timestamp>_learning.sql`

1. Write failing integration tests for version creation, provenance, precedence, conflict creation, correction, acceptance, rejection, export, soft deletion, and retention.
2. Run the focused integration test; expect missing-table/repository failures.
3. Add the four learning tables and transaction-safe repository operations.
4. Rerun focused tests and the full suite; expect success.
5. Commit as `T2.9: persist versioned learning state`.

### Task 3: Implement adaptive education

**Files:**
- Create: `packages/learning/src/education-service.ts`
- Create: `packages/learning/src/education-service.test.ts`
- Create: `packages/learning/src/prompts/education.ts`
- Create: `evals/education/goldens.json`

1. Write failing tests for structured output, level adaptation, deterministic fallback, uncertainty handling, and zero execution dependencies.
2. Run the focused test; expect missing implementation failure.
3. Implement the minimal education service with “what, how, why, risks, example, limitations, check” output.
4. Run focused tests, education goldens, typecheck, and the full test suite.
5. Commit as `T2.10: add adaptive crypto education`.

### Task 4: Implement advice and decision journal

**Files:**
- Create: `packages/learning/src/advice-service.ts`
- Create: `packages/learning/src/advice-service.test.ts`
- Create: `packages/learning/src/decision-journal.ts`
- Create: `evals/advice/goldens.json`

1. Write failing tests for profile provenance, stale/conflicting fallback, evidence labeling, alternatives, downside, invalidation, stale market rejection, and unsupported jurisdiction fallback.
2. Add prompt-injection goldens whose embedded instructions attempt to mutate profile, risk, and approval state.
3. Implement schema-constrained advice generation and journal persistence without importing execution services.
4. Run focused tests, advice evals, typecheck, and the full suite.
5. Commit as `T2.11: add profile-aware advice`.

### Task 5: Implement learned change proposals

**Files:**
- Create: `packages/learning/src/change-proposal.ts`
- Create: `packages/learning/src/change-proposal.test.ts`
- Create: `apps/api/src/routes/change-proposals.ts`
- Test: `tests/change-proposal.integration.test.ts`

1. Write failing tests for exact hashes, stale versions, rejection, reuse, concurrency, rollback criteria, and separation from order approval.
2. Implement immutable proposal creation and transaction-safe approve/apply operations using optimistic concurrency.
3. Add authenticated review endpoints and structured audit events.
4. Run focused tests, typecheck, and the full suite.
5. Commit as `T2.12: gate learned strategy and risk changes`.

### Task 6: Add profile and education APIs

**Files:**
- Create: `apps/api/src/routes/profile.ts`
- Create: `apps/api/src/routes/education.ts`
- Create: `apps/api/src/routes/advice.ts`
- Test: `tests/learning-api.integration.test.ts`

1. Write failing authentication, validation, export, deletion, error-redaction, and learning-store-failure tests.
2. Implement the TECH_SPEC §7 routes using the learning services only.
3. Verify kill-switch, pause, and cancellation remain available during simulated learning-store failure.
4. Run integration tests, typecheck, and the full suite.
5. Commit as `T2.11: expose controlled learning APIs`.

### Task 7: Wire release-blocking evals and telemetry

**Files:**
- Create: `evals/run.ts`
- Create: `evals/learning/goldens.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `packages/core/src/metrics.ts`

1. Write failing runner tests for category scoring and release-blocking authority/injection failures.
2. Implement deterministic fixtures, redacted result logging, and the documented metrics.
3. Run `pnpm eval`, `pnpm typecheck`, and `pnpm test`; expect all to pass.
4. Update the runbook with exact operational commands only after the scripts exist.
5. Commit as `TX.4: enforce education and learning evals`.

### Task 8: Build the premium operator experience

**Files:**
- Modify: `apps/dashboard/src/app/*`
- Modify: `apps/dashboard/src/components/*`
- Create: `apps/dashboard/src/components/ui/*`
- Create: `apps/dashboard/tests/accessibility/*`
- Create: `apps/dashboard/tests/e2e/*`
- Create: `apps/dashboard/tests/visual/*`

1. Inventory every current component and write failing component-state tests for loading, empty, fresh, stale, degraded, error, retrying, disabled, and read-only behavior.
2. Define shared tokens for typography, spacing, color, focus, motion, layout, feedback, and data visualization; add Storybook-equivalent fixtures or a local component-state route.
3. Write failing accessibility tests for landmarks, labels, focus order, keyboard-only operation, non-color status, reduced motion, and 200% zoom.
4. Implement responsive overview, education, profile, advice, proposal, audit, and safety workflows using progressive disclosure and persistent system status.
5. Add exact-preview diffs, material risk/fee/slippage/expiry presentation, deliberate approve/reject controls, and sanitized rich-text rendering.
6. Add desktop/tablet visual baselines and browser tests for all safety-critical flows.
7. Run accessibility checks, visual regression, browser tests, Web Vitals collection, `pnpm typecheck`, and `pnpm test`; expect all release gates to pass.
8. Commit as `T4.5: deliver premium operator dashboard`.
