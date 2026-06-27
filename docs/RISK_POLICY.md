# Risk Policy

The scaffold fails closed by default. `TRADING_MODE=paper` is the default, live trading requires explicit acknowledgement, and the first live rollout refuses to start if max notional is above the conservative bootstrap limit.

## Hard limits

- Product must be in `ENABLED_PRODUCTS`.
- Trade notional must be positive and at or below `MAX_TRADE_NOTIONAL_USD`.
- Daily PnL must remain above the configured max daily loss threshold.
- Total and product exposure must remain below configured limits.
- Shorting is disabled unless explicitly enabled.
- Live mode requires Coinbase credentials and `LIVE_TRADING_ACK=true`.
- A risk-approved live proposal must still have a valid operator approval bound to its exact order preview.

Risk approval is a veto decision, not execution authorization. An approval expires after the configured TTL, cannot be reused, and becomes invalid if the intent or preview changes. Absence, mismatch, expiry, or uncertain approval state fails closed.

## Learning boundary

Learning and personalized advice cannot alter this policy directly. Crypto Guy may propose a new limit, sizing rule, enabled product, or strategy parameter only with supporting evidence, expected impact, downside analysis, and rollback criteria. The current signed/versioned policy remains active until the operator explicitly approves the change through the policy-change workflow. Trade approval and policy-change approval are separate, non-transferable decisions.

## Promotion path

Start with paper mode, then sandbox request-shape validation, then live read-only shadow mode, then live micro-orders. Do not increase notional limits until reconciliation, logging, alerting, and kill-switch paths have been exercised.
