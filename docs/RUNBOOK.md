# Crypto Guy Runbook

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

## Interactive live approval

Live mode may compute and preview proposals automatically. Review the proposal's intent, rationale, risk results, estimated fees/slippage, preview hash, and expiry before approving it through the authenticated operator API or dashboard. Approval is single-use and authorizes only that exact preview. Reject unexpected proposals; let stale proposals expire. Never treat `LIVE_TRADING_ACK=true` as approval for an individual trade.

## Learning and personalization operations

The learning APIs and dashboard controls are planned and must not be treated as implemented until their implementation-plan acceptance tests pass. They will support viewing and correcting the operator profile, accepting or rejecting inferred insights, exporting or deleting learning data, reviewing advice provenance, and approving or rejecting strategy/risk change proposals.

If learning storage is unavailable, continue deterministic safety operations but disable profile updates and personalized advice. If profile facts conflict or become stale, resolve them before relying on personalized guidance. Never enter credentials, private keys, seed phrases, or API tokens into educational or profile fields.

## Deployment and recovery (T6.9)

**Production stack.** Build and run the least-privilege composition — five
services: `postgres`, `redis`, `api` (:3000), `worker` (loop), `dashboard`
(:4000):

```bash
cp .env.example infra/.env.production   # fill in secrets; never commit it
docker compose -f infra/compose.production.yml up -d --build
```

Containers run as the non-root `node` user with read-only root filesystems and
`no-new-privileges`. Postgres and Redis persist to named volumes. The dashboard
is a Next.js standalone image; the API exposes `/health` (liveness) and
`/health/ready` (dependency readiness; returns 503 when a dependency is down) for
orchestrator probes.

**Compose env (`infra/.env.production`).** Inside the compose network, services
reach each other by service name — not `localhost`. Override these from the
`.env.example` defaults:

```env
DATABASE_URL=postgresql://crypto_agent:<pw>@postgres:5432/crypto_agent
REDIS_URL=redis://redis:6379
AGENT_API_URL=http://api:3000        # dashboard + worker -> API
POSTGRES_USER=crypto_agent
POSTGRES_PASSWORD=<pw>
POSTGRES_DB=crypto_agent
WORKER_LOOP_MS=20000                 # 0 = single pass; >0 = continuous loop
# plus OPERATOR_API_TOKEN, INTERNAL_API_TOKEN, ALLOWED_ORIGINS, STRATEGY, etc.
```

The operator token stays server-side: the dashboard's proxy attaches it, so it
never reaches the browser.

**Migrations** run via `pnpm db:migrate`, which applies every unapplied
`NNN_*.sql` in order and records it in `schema_migrations` (idempotent).

**Backups.** `pnpm backup [outDir]` runs a custom-format `pg_dump`, optionally
`age`-encrypts it (`BACKUP_AGE_RECIPIENT`), and prints a sha256 checksum. Store
backups off-host. **A backup is not trusted until restored:** periodically run
`pnpm restore:verify <backup.dump> <scratchDatabaseUrl>` to restore into a
disposable database and confirm the core tables exist with rows.

**Going live.** `pnpm live:preflight` is the gate. It reads the environment and a
read-only reconciliation result and exits non-zero unless EVERY check passes
(live mode, `LIVE_TRADING_ACK=true`, notional within the bootstrap ceiling,
Coinbase credentials, strong/distinct API tokens, durable state, Redis, an alert
webhook, and a clean reconciliation). It cannot set the acknowledgement or bypass
a failure — both are inputs it only reports on. `RECONCILIATION_OK=true` must be
set by an out-of-band read-only reconciliation; the preflight never fabricates it.
