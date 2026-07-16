# Deployment notes

## Railway (api, worker, dashboard)
Railway builds these services with **Nixpacks** and per-service start commands
(`pnpm --filter @agent/<svc> dev|start`). Do **not** put a `Dockerfile` at the
repo root: Railway auto-detects it and switches every service to a single Docker
build (last stage = dashboard), which breaks the api/worker. The production
Dockerfile lives at `infra/Dockerfile` for manual/other use:

    docker build -f infra/Dockerfile --target runtime .     # api/worker
    docker build -f infra/Dockerfile --target dashboard .   # dashboard

A future move to Docker-based Railway deploys would require configuring each
service's Dockerfile path/target and start command in the Railway dashboard.
