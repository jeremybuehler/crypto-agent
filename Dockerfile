# Multi-stage, reproducible build for the API, worker, and dashboard. Runs as a
# non-root user; each runtime image carries only production deps and built
# output. Build a specific service with `--target` (api/worker share `runtime`;
# the dashboard uses `dashboard`).
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- deps: install with the lockfile for reproducibility ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

# --- build: compile TypeScript project references ---
FROM deps AS build
RUN pnpm build
# Prune dev dependencies for the runtime image.
RUN pnpm prune --prod

# --- runtime: minimal, non-root (API + worker) ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# node:20 image ships an unprivileged "node" user (uid 1000).
COPY --from=build --chown=node:node /app /app
USER node
# Liveness probe target for orchestrators.
EXPOSE 3000
# Default to the API; the worker overrides command in compose.
CMD ["node", "apps/api/dist/index.js"]

# --- dashboard-build: compile the Next.js dashboard to a standalone bundle ---
# Runs off `deps` (dev deps present) so Tailwind/PostCSS/TS are available.
FROM deps AS dashboard-build
RUN pnpm --filter @agent/dashboard build

# --- dashboard: minimal standalone runtime (plain node, no pnpm) ---
FROM node:20-bookworm-slim AS dashboard
ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Next standalone ships the server + traced node_modules; the static assets are
# emitted separately and must be copied alongside it.
COPY --from=dashboard-build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=dashboard-build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 4000
CMD ["node", "apps/dashboard/server.js"]
