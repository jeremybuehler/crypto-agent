# ACT — Autonomous Crypto Trading Agent

Safety-first autonomous crypto trading on Coinbase Advanced Trade. Spot only, paper-first, single operator.

The deterministic risk engine is the final authority on every order. The LLM provides structured market context only — it never sees credentials and never emits an executable order.

## Start here

Read in this order:

1. **[PRD.md](./PRD.md)** — what we're building, goals, success metrics, scope
2. **[autonomous_crypto_trading_agent_architecture.md](./autonomous_crypto_trading_agent_architecture.md)** — full technical architecture (source of truth)
3. **[TECH_SPEC.md](./TECH_SPEC.md)** — concrete module interfaces, data models, API contracts
4. **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** — phased tickets sized for Claude Code
5. **[CLAUDE.md](./CLAUDE.md)** — how Claude Code should operate inside this repo

## Operational docs

- **[RUNBOOK.md](./RUNBOOK.md)** — commands for setup, dev, inspecting audit records, safety ops
- **[RISK_POLICY.md](./RISK_POLICY.md)** — hard limits and the paper → live promotion path
- **[LIVE_TRADING_CHECKLIST.md](./LIVE_TRADING_CHECKLIST.md)** — gates that must pass before live mode

## Quick start (paper mode)

```bash
cp .env.example .env
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm paper:once
```

Then inspect what happened:

```bash
psql "$DATABASE_URL" -c "select product_id, market_regime, do_not_trade from ai_contexts order by created_at desc limit 5;"
psql "$DATABASE_URL" -c "select approved, rejection_reasons from risk_decisions order by checked_at desc limit 5;"
```

## Safety reminders

- Default mode is `paper`. The app refuses to start in `live` mode unless `LIVE_TRADING_ACK=true` AND `MAX_TRADE_NOTIONAL_USD` is below the bootstrap ceiling.
- The kill switch (`POST /ops/kill-switch`) halts new orders within one loop tick.
- Every order has a full audit chain: market snapshot → features → AI context → trade intent → risk decision → preview → execution → fill.
- This system can lose money. Operate accordingly.

## Status

v1 in active scaffolding. See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for phase progress.
