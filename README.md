# Crypto Guy

AI-assisted, risk-first interactive crypto trading and education scaffold targeting Coinbase Advanced Trade. Crypto Guy explains crypto concepts, shows how it reached each proposal, and learns from the operator under explicit memory and change-control policies. Its local dashboard is designed as a polished, accessible, responsive operator product—not a bare admin panel.

## Status

This repo is intentionally paper-mode first. The LLM layer is represented by a conservative structured-output stub, the strategy is deterministic, and the risk engine is the final authority before any paper execution.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm typecheck
pnpm test
pnpm paper:once
```

## Packages

- `@agent/core`: config, shared types, logger, live-mode gate.
- `@agent/ai`: structured AI context schema and conservative stub provider.
- `@agent/market-data`: candle and feature calculations.
- `@agent/strategy`: AI-assisted trend strategy.
- `@agent/risk`: deterministic risk engine.
- `@agent/execution`: paper broker and execution boundaries.
- `@agent/coinbase`: Coinbase REST/JWT client boundary.
- `@agent/persistence`: Postgres audit repository and migrations.
- `@agent/backtest`: placeholder for historical simulation.

## Market data

The worker uses Coinbase public market-data endpoints for best bid/ask and recent candles. Set `USE_SAMPLE_MARKET_DATA=true` to force deterministic sample data for offline local testing.

## Persistence

Set `DATABASE_URL` and keep `PERSISTENCE_ENABLED=true` to store market snapshots, AI contexts, trade intents, risk decisions, and paper fills in Postgres. For offline tests or throwaway local runs without Postgres, set `PERSISTENCE_ENABLED=false`.

## Safety stance

The system should not allow an LLM to place trades directly. LLM output is context only; deterministic strategy and risk code may propose a trade. Every strategy-generated live order also requires an explicit, single-use operator approval after preview and before submission. Learning may personalize education and advice, but it may never silently change strategy, risk, or execution permissions.
