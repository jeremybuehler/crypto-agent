# Crypto Agent Runbook

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm typecheck
pnpm test
pnpm paper:once
```

If Coinbase public market data is unavailable or you want deterministic local behavior, set `USE_SAMPLE_MARKET_DATA=true`.
If Postgres is not running and you only want an offline smoke test, set `PERSISTENCE_ENABLED=false`.

## Start dependencies

```bash
docker compose -f infra/docker-compose.yml up -d
```

The worker runs the migration automatically on startup when `PERSISTENCE_ENABLED=true`.

## Inspect persisted audit records

```bash
psql "$DATABASE_URL" -c "select product_id, price, created_at from market_snapshots order by created_at desc limit 5;"
psql "$DATABASE_URL" -c "select product_id, market_regime, confidence, do_not_trade, created_at from ai_contexts order by created_at desc limit 5;"
psql "$DATABASE_URL" -c "select product_id, side, quote_size_usd, created_at from trade_intents order by created_at desc limit 5;"
psql "$DATABASE_URL" -c "select approved, reasons, checked_at from risk_decisions order by checked_at desc limit 5;"
psql "$DATABASE_URL" -c "select product_id, side, quote_size_usd, price, filled_at from paper_fills order by filled_at desc limit 5;"
```

## Start services

```bash
pnpm dev:api
pnpm dev:worker
```

## Safety operations

- Pause new trading: `POST /ops/pause`
- Resume paper/sandbox trading: `POST /ops/resume`
- Trigger kill switch: `POST /ops/kill-switch`
- Clear kill switch: `POST /ops/clear-kill-switch`

The scaffold refuses to clear the kill switch through the API in live mode.
