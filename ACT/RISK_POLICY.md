# Risk Policy

The scaffold fails closed by default. `TRADING_MODE=paper` is the default, live trading requires explicit acknowledgement, and the first live rollout refuses to start if max notional is above the conservative bootstrap limit.

## Hard limits

- Product must be in `ENABLED_PRODUCTS`.
- Trade notional must be positive and at or below `MAX_TRADE_NOTIONAL_USD`.
- Daily PnL must remain above the configured max daily loss threshold.
- Total and product exposure must remain below configured limits.
- Shorting is disabled unless explicitly enabled.
- Live mode requires Coinbase credentials and `LIVE_TRADING_ACK=true`.

## Promotion path

Start with paper mode, then sandbox request-shape validation, then live read-only shadow mode, then live micro-orders. Do not increase notional limits until reconciliation, logging, alerting, and kill-switch paths have been exercised.
