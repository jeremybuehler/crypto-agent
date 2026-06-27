# Crypto Guy Education and Continuous Learning Design

**Status:** Approved design; not yet implemented  
**Date:** 2026-06-19  
**Initial scope:** U.S.-based personal use, designed for later jurisdiction-gated expansion

## Outcome

Crypto Guy teaches crypto trading, explains its analysis and proposals, and provides personalized guidance based on a controlled, continuously learning operator profile. Learning improves education and advice, but never grants execution authority or silently changes strategy or risk policy.

## Experience

Responses use three layers:

1. **Learn** — what a concept is, how it works, why it matters, risks, examples, limitations, and an optional comprehension check.
2. **Analyze** — evidence, reasoning, assumptions, contrary signals, confidence, downside scenarios, invalidation conditions, and why the conclusion may be wrong.
3. **Advise** — profile-aware guidance identifying the exact approved facts and reviewable insights used, plus alternatives including no action.

Every recommendation answers what is happening, why it matters, how the conclusion was reached, how it relates to the operator profile, what could invalidate it, what alternatives exist, and what approval would do. Facts, estimates, assumptions, and opinions remain distinct. No response guarantees profit or loss prevention.

## Controlled continuous learning

Crypto Guy maintains four separate layers:

- **Education profile:** concepts encountered, demonstrated understanding, misconceptions, and next topics.
- **Operator profile:** explicit goals, experience, time horizon, liquidity needs, financial constraints, jurisdiction, and risk tolerance.
- **Decision journal:** recommendations, operator decisions, rationale, outcomes, and retrospective lessons.
- **Strategy research:** evidence-backed suggestions for strategy or risk changes.

Education progress and allowlisted factual observations may update automatically. Derived insights are visible, confidence-scored, editable, rejectable, and deletable. Explicit facts always outrank inferences. Conflicts trigger review. Strategy and risk suggestions remain immutable proposals until separately approved; order approval and change approval are never interchangeable.

## UI/UX quality bar

Crypto Guy's dashboard is a first-class operator experience. It uses a coherent design system, strong visual hierarchy, responsive layouts, and progressive disclosure so a user can see the essential decision first and inspect evidence, education, and audit detail without losing context.

Every data-dependent surface explicitly renders loading, empty, fresh, stale, degraded, error, retrying, and read-only states. Current trading mode, kill-switch state, data freshness, connectivity, and pending approvals remain persistently visible. Educational content defines jargon in place and connects explanations to the exact chart, metric, recommendation, or profile factor being discussed.

Safety-critical interactions are deliberate and accessible. Order approval shows an exact preview summary and changes since the prior view. Fees, slippage, confidence, risk failures, expiry, and downside are never hidden. Approve, reject, pause, cancel, and kill-switch actions are visually distinct, keyboard operable, screen-reader labeled, and protected from accidental activation without using manipulative confirmation patterns.

The target is WCAG 2.2 AA, full keyboard operation, non-color status cues, reduced-motion support, and responsive desktop/tablet layouts. Performance targets are LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1 under the supported deployment profile. Component states, critical flows, and responsive breakpoints require visual-regression and end-to-end coverage.

## Memory and privacy

Every learned item records source, evidence, confidence, scope, creation time, last confirmation, review status, and retention. The operator can inspect, correct, accept, reject, export, and delete learning data. Secrets, credentials, private keys, seed phrases, account identifiers, and raw sensitive tool output are forbidden learning inputs.

Postgres is the source of truth. Session state and caches are derived. Retention periods must be configured before live operation. Deletion removes data from future personalization and retains only a minimal non-sensitive audit tombstone where required.

## Safety and failure behavior

- Missing, conflicting, stale, or unsupported-jurisdiction profile data reduces personalization or triggers a question.
- Stale market data prohibits current-market advice.
- Model or schema failure yields deterministic education or no recommendation.
- Learning-store failure disables profile updates and personalized advice without blocking pause, kill-switch, or cancellation.
- External content is untrusted evidence, never instructions or authority.
- Learning cannot directly mutate strategy, risk, configuration, credentials, approvals, or execution state.

## Evaluation

Unit and integration tests cover precedence, conflict resolution, corrections, rejection, deletion, retention, provenance, concurrency, and failure isolation. Behavioral evals cover explanation quality, unsupported claims, misleading certainty, risk omission, stale evidence, profile misuse, jurisdiction fallback, prompt injection, strategy-change approval, and the invariant that education never triggers execution. Outcome evaluation tracks calibration and operator overrides; profit alone is never treated as proof that advice was sound.
