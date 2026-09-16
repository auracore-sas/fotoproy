# syntax=docker/dockerfile:1
#
# FotoProy API — production image (monorepo aware).
#
# The API is the only long-running process we deploy: the mobile app ships
# through the app stores / EAS Update, and object storage lives in
# Cloudflare R2 (S3 API).
#
# Build (build context = repository root):
#   docker build -t fotoproy-api:latest .
# Run:
#   docker run --env-file apps/api/.env -p 4100:4100 fotoproy-api:latest
#
# Notes:
# - Node 26 + pnpm 11 match `.nvmrc` and `packageManager`.
# - pnpm 11 defers dependency build scripts, so `prisma generate` runs
#   explicitly (same gotcha documented in AGENTS.md).
# - sharp ships prebuilt linux-x64 binaries (@img/sharp-linux-x64): no
#   compiler toolchain is needed in the image.
# - The mobile workspace is NOT installed (its manifest is copied only so the
#   frozen lockfile stays valid). The API does not depend on it.

# ---------------------------------------------------------------------------
# Stage 1 — install + build
# ---------------------------------------------------------------------------
FROM node:26-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

# Node 26 no longer bundles corepack, so pnpm is installed with npm.
# openssl is needed by Prisma to pick the right query engine for this distro.
RUN npm install -g pnpm@11.24.0 \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first: this layer is cached while dependencies do not change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
# The Prisma schema must exist before installing: pnpm runs the deferred
# `prisma generate` postinstall of packages/database (AGENTS.md gotcha).
COPY packages/database/prisma ./packages/database/prisma
RUN pnpm install --frozen-lockfile --filter @fotoproy/api...

# Sources, then build in topological order (shared → database → api).
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @fotoproy/database db:generate \
  && pnpm --filter @fotoproy/shared build \
  && pnpm --filter @fotoproy/database build \
  && pnpm --filter @fotoproy/api build \
  && chown -R node:node /app

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

# openssl: the Prisma query engine needs libssl; debian slim does not ship it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.24.0

WORKDIR /app

# The whole workspace is copied so `pnpm --filter @fotoproy/database db:deploy`
# (Prisma migrations) can run inside this same image.
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
