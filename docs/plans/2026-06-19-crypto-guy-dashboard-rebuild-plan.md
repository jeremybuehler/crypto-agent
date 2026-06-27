# Crypto Guy Dashboard Clean-Slate Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the existing dashboard UI and replace it with a premium, accessible, responsive, safety-first operator experience without breaking validated API behavior.

**Architecture:** Keep the `apps/dashboard` Next.js package boundary and API rewrite, but delete the existing page, components, terminal theme, and unsafe client assumptions. Establish runtime-validated API contracts, a tested design system, and workflow-oriented feature modules. Build the replacement behind a minimal shell and promote each workflow only after component-state, accessibility, browser, visual, and performance gates pass.

**Tech Stack:** Next.js 15, React 19, TypeScript strict mode, Tailwind CSS, SWR, Zod, Vitest, Testing Library, axe-core, Playwright, and visual snapshots.

---

## Constraints

- Do not preserve the current visual design or component hierarchy.
- Preserve API behavior only through explicit, runtime-validated contracts and tests.
- Do not weaken pause, kill-switch, approval, stale-data, authentication, or audit requirements to simplify UI work.
- Do not expose education, advice, memory, or approval screens before their backing APIs exist; render an honest unavailable/planned state instead.
- Do not delete the dashboard package, Next.js rewrite, or root `dev:dashboard` command until a replacement path is proven.
- Keep the existing untracked `apps/dashboard/tsconfig.json` under user ownership; inspect and intentionally adopt or replace it during Task 2 rather than deleting it incidentally.

## Legacy disposition

Delete during Task 2:

- `apps/dashboard/src/app/page.tsx`
- `apps/dashboard/src/app/globals.css`
- `apps/dashboard/src/components/Header.tsx`
- `apps/dashboard/src/components/LastTradePanel.tsx`
- `apps/dashboard/src/components/OpsPanel.tsx`
- `apps/dashboard/src/components/PortfolioPanel.tsx`
- `apps/dashboard/src/components/RiskConfig.tsx`
- `apps/dashboard/src/components/TradeFeed.tsx`
- `apps/dashboard/tailwind.config.js` after its terminal-only tokens are captured as rejected legacy behavior

Replace rather than preserve:

- `apps/dashboard/src/lib/api.ts` because it trusts unvalidated JSON and exposes weak string types.
- `apps/dashboard/src/app/layout.tsx` because its metadata and global terminal presentation are obsolete.

Retain initially:

- `apps/dashboard/package.json`
- `apps/dashboard/next.config.js` and its `/api/*` rewrite
- `apps/dashboard/postcss.config.js`
- `apps/dashboard/tsconfig.json`, subject to strict-mode replacement
- Root `dev:dashboard` script and workspace registration

### Task 1: Freeze backend behavior as dashboard contract tests

**Files:**
- Create: `apps/dashboard/src/contracts/status.ts`
- Create: `apps/dashboard/src/contracts/portfolio.ts`
- Create: `apps/dashboard/src/contracts/trades.ts`
- Create: `apps/dashboard/src/contracts/metrics.ts`
- Create: `apps/dashboard/src/contracts/contracts.test.ts`
- Modify: `apps/dashboard/package.json`

1. Add focused test dependencies and scripts for Vitest.
2. Write failing tests using representative payloads from `/status`, `/portfolio`, `/trades`, and `/metrics` in `apps/api/src/index.ts`.
3. Add malformed, missing-field, invalid-enum, non-finite-number, and unexpected-null cases; expect parsing failures.
4. Run `pnpm --filter @agent/dashboard test`; expect failure because schemas do not exist.
5. Implement minimal Zod schemas and inferred TypeScript types.
6. Run the focused suite; expect all contract tests to pass.
7. Commit as `T4.5: freeze dashboard API contracts`.

### Task 2: Delete the legacy UI and install a safe replacement shell

**Files:**
- Delete: all files listed under “Delete during Task 2”
- Replace: `apps/dashboard/src/app/layout.tsx`
- Create: `apps/dashboard/src/app/page.tsx`
- Create: `apps/dashboard/src/app/globals.css`
- Create: `apps/dashboard/tailwind.config.ts`
- Modify: `apps/dashboard/tsconfig.json`
- Test: `apps/dashboard/src/app/page.test.tsx`

1. Write a failing shell test requiring a “Crypto Guy,” “dashboard rebuild in progress,” and non-operational status message.
2. Remove the legacy page, components, styling, and Tailwind theme in one patch.
3. Replace the TypeScript config with strict settings compatible with the workspace.
4. Add a semantic minimal shell with no fake values, no trading controls, and no implied live capability.
5. Run dashboard test, typecheck, and build; expect success.
6. Confirm `rg 'terminal-|Autonomous Crypto Trader|equityUsd \\?\\? 1000|console.error' apps/dashboard/src` returns no legacy matches.
7. Commit as `T4.5: remove legacy dashboard UI`.

### Task 3: Establish design foundations before feature screens

**Files:**
- Create: `apps/dashboard/src/styles/tokens.css`
- Create: `apps/dashboard/src/components/ui/button.tsx`
- Create: `apps/dashboard/src/components/ui/card.tsx`
- Create: `apps/dashboard/src/components/ui/status-badge.tsx`
- Create: `apps/dashboard/src/components/ui/data-state.tsx`
- Create: `apps/dashboard/src/components/ui/dialog.tsx`
- Create: `apps/dashboard/src/components/ui/*.test.tsx`
- Create: `apps/dashboard/src/app/design-system/page.tsx`

1. Define semantic tokens for typography, spacing, surfaces, borders, focus, status, charts, motion, and breakpoints; do not encode trading meaning in raw color names.
2. Write failing state and accessibility tests for each primitive.
3. Implement keyboard interaction, visible focus, non-color cues, reduced motion, semantic labels, disabled/busy states, and 200% zoom behavior.
4. Add a development-only design-system route showing every state and responsive variant.
5. Run component and axe tests; expect no serious or critical violations.
6. Capture baseline desktop/tablet screenshots for review before feature work.
7. Commit as `T4.5: add dashboard design foundations`.

### Task 4: Build the validated data and freshness layer

**Files:**
- Create: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/src/lib/api-error.ts`
- Create: `apps/dashboard/src/lib/freshness.ts`
- Create: `apps/dashboard/src/hooks/use-dashboard-resource.ts`
- Test: corresponding `*.test.ts` files

1. Write failing tests for successful parsing, HTTP errors, schema errors, timeouts, aborts, retry policy, and redacted diagnostics.
2. Write deterministic freshness tests for fresh, aging, stale, and unknown timestamps using an injected clock.
3. Implement typed fetch and mutation clients that parse every response and never substitute financial defaults.
4. Implement SWR integration exposing loading, empty, fresh, stale, degraded, error, retrying, and read-only states.
5. Verify mutation failures produce visible actionable messages rather than console-only errors.
6. Run focused tests, typecheck, and build.
7. Commit as `T4.5: add validated dashboard data layer`.

### Task 5: Build the persistent operator shell

**Files:**
- Create: `apps/dashboard/src/components/shell/app-shell.tsx`
- Create: `apps/dashboard/src/components/shell/system-status.tsx`
- Create: `apps/dashboard/src/components/shell/navigation.tsx`
- Create: `apps/dashboard/src/components/shell/command-menu.tsx`
- Test: shell component and accessibility tests

1. Write failing tests requiring persistent mode, pause/kill state, connectivity, freshness, pending-action count, and accessible navigation.
2. Implement responsive desktop/tablet navigation without hiding safety status.
3. Add skip links, landmarks, keyboard navigation, focus restoration, reduced motion, and screen-reader announcements.
4. Verify unknown or stale state is never rendered as healthy.
5. Run component, keyboard, and axe tests.
6. Commit as `T4.5: add operator application shell`.

### Task 6: Rebuild overview, portfolio, trades, and risk as workflows

**Files:**
- Create: `apps/dashboard/src/features/overview/*`
- Create: `apps/dashboard/src/features/portfolio/*`
- Create: `apps/dashboard/src/features/trades/*`
- Create: `apps/dashboard/src/features/risk/*`
- Create: `apps/dashboard/src/app/(operator)/page.tsx`
- Test: feature component and browser tests

1. Write feature tests for all resource states before implementing happy paths.
2. Present equity, cash, exposure, PnL, positions, fills, fees, and limits without invented defaults.
3. Use labels/icons/textures in addition to color for positive, negative, warning, and blocked states.
4. Add progressive detail for calculation methodology, timestamps, strategy versions, and source data.
5. Add responsive table-to-detail patterns that preserve material values on tablet.
6. Run feature tests, visual snapshots, and browser smoke tests.
7. Commit as `T4.5: rebuild operator overview workflows`.

### Task 7: Rebuild safety operations with deliberate interaction design

**Files:**
- Create: `apps/dashboard/src/features/operations/pause-control.tsx`
- Create: `apps/dashboard/src/features/operations/kill-switch-control.tsx`
- Create: `apps/dashboard/src/features/operations/cancel-orders-control.tsx`
- Create: `apps/dashboard/src/features/operations/operation-result.tsx`
- Test: operation component and integration tests

1. Write failing tests for pending, success, backend rejection, timeout, stale status, duplicate activation, and live-mode clear refusal.
2. Implement plain-language impact summaries and confirmations proportional to consequence.
3. Keep pause, kill switch, and cancellation usable during noncritical dashboard failures.
4. Prevent optimistic UI from claiming safety state before the API confirms it.
5. Verify keyboard-only use, focus restoration, screen-reader announcements, and non-color status.
6. Run component, integration, and browser tests.
7. Commit as `T4.5: rebuild safety operation workflows`.

### Task 8: Add education, profile, advice, and proposal surfaces behind capability gates

**Files:**
- Create: `apps/dashboard/src/features/education/*`
- Create: `apps/dashboard/src/features/profile/*`
- Create: `apps/dashboard/src/features/advice/*`
- Create: `apps/dashboard/src/features/proposals/*`
- Create: `apps/dashboard/src/lib/capabilities.ts`
- Test: feature and capability tests

1. Write failing tests proving unavailable backend capabilities render honest planned/unavailable states and never fake data.
2. Add Learn/Analyze/Advise progressive disclosure and source/profile provenance presentation.
3. Add inspect/correct/accept/reject/export/delete memory controls only when backing APIs validate.
4. Add exact order-preview and learned-change proposal review with distinct, non-transferable approvals.
5. Sanitize all external and LLM-authored content; add hostile markup and prompt-injection rendering fixtures.
6. Run feature, accessibility, security-rendering, and browser tests.
7. Commit as `T4.5: add gated learning and proposal UX`.

### Task 9: Enforce full-state, accessibility, responsive, and visual quality gates

**Files:**
- Create: `apps/dashboard/tests/accessibility/*.spec.ts`
- Create: `apps/dashboard/tests/e2e/*.spec.ts`
- Create: `apps/dashboard/tests/visual/*.spec.ts`
- Create: `apps/dashboard/playwright.config.ts`
- Modify: `apps/dashboard/package.json`

1. Add Playwright projects for supported desktop and tablet viewports, reduced motion, and high-zoom review.
2. Add critical journeys: load degraded API, recover, pause, resume, kill switch, failed mutation, inspect trade, and gated future capability.
3. Add automated accessibility scans plus manual keyboard/screen-reader checklist output.
4. Capture visual baselines only after approved design review; do not bless unexplained diffs.
5. Measure LCP, INP, and CLS against the documented profile; fail the release gate when budgets regress.
6. Run `pnpm --filter @agent/dashboard test`, `test:e2e`, `test:visual`, `build`, root typecheck, and root tests.
7. Commit as `T4.5: enforce dashboard quality gates`.

### Task 10: Cut over and remove transitional scaffolding

**Files:**
- Delete: development-only rebuild placeholders and obsolete fixtures
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md`
- Modify: CI workflow and root scripts as required

1. Verify every implemented API capability is represented and every unimplemented capability is explicitly gated.
2. Run a clean-install dashboard build and the complete repository validation suite.
3. Exercise the dashboard against the real local API with paper-mode sample data.
4. Review logs for secrets, raw sensitive payloads, console-only failures, and unhandled promise rejections.
5. Update operational commands and mark acceptance criteria complete only from fresh evidence.
6. Commit as `T4.5: cut over premium Crypto Guy dashboard`.

## Release gate

The replacement is not complete until:

- The legacy component and terminal-theme files are gone.
- No financial value is fabricated as a loading fallback.
- API responses are runtime validated.
- Every resource surface implements the full state model.
- Safety controls work during noncritical UI/data failures.
- Critical workflows pass accessibility, keyboard, responsive, visual, browser, and performance checks.
- Education/advice/proposal features are capability-gated until their APIs exist.
- Root typecheck and tests, dashboard build/tests, and clean local paper-mode verification all pass.
