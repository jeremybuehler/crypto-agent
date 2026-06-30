# Multi-stage, reproducible build for the API and worker. Runs as a non-root
# user; the runtime image carries only production deps and built output.
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

# --- runtime: minimal, non-root ---
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
