# Live Trading Checklist

- [ ] Paper-trading results reviewed.
- [ ] Sandbox request-shape tests pass.
- [ ] Live read-only account reconciliation passes.
- [ ] Coinbase API key is scoped to minimum required permissions.
- [ ] `MAX_TRADE_NOTIONAL_USD` is intentionally tiny.
- [ ] Kill switch has been tested.
- [ ] Alerting is configured for every live order.
- [ ] Operator accepts that this system can lose money.
- [ ] `LIVE_TRADING_ACK=true` is set only for the deployment intended to trade.
