# syntax=docker/dockerfile:1.7
#
# Production image for the SIHL ONE API.
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies and
# no source. Smaller image, faster pulls, and materially less to exploit.

# --- Stage 1: install -------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only manifests first. This layer is cached until a dependency actually
# changes, so ordinary code edits skip a full npm install.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --ignore-scripts

# --- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# npm workspaces hoists every dependency to the root node_modules and symlinks
# the workspace packages into it. A nested packages/contracts/node_modules only
# appears when a version conflict forces one, so copying it unconditionally
# fails the build on a clean install.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build -w @sihl-one/contracts \
 && npm run db:generate -w @sihl-one/api \
 && npm run build -w @sihl-one/api \
 && npm prune --omit=dev

# --- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# tini reaps zombies and forwards SIGTERM, so Nest's shutdown hooks actually run
# and in-flight requests drain instead of being cut off mid-transaction.
#
# su-exec drops privileges in the entrypoint. The container has to start as root
# for exactly one reason — see the volume note there — and hands over to the
# unprivileged user before anything else happens.
RUN apk add --no-cache tini su-exec

# Never run as root. A container escape should not start from uid 0.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nodejs -G nodejs

COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=nodejs:nodejs /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build --chown=nodejs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nodejs:nodejs /app/apps/api/prisma ./apps/api/prisma
# The seed and bootstrap scripts import the generated client from src/, not from
# dist/. Prisma 7 emits TypeScript rather than a prebuilt package, so the source
# has to be present for those one-off tasks to resolve it.
COPY --from=build --chown=nodejs:nodejs /app/apps/api/src/generated ./apps/api/src/generated
COPY --from=build --chown=nodejs:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=nodejs:nodejs /app/apps/api/prisma.config.production.mjs ./apps/api/
COPY --chmod=755 apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

# Deliberately no `USER nodejs` here. The entrypoint starts as root, fixes the
# ownership of the mounted volume — the one thing that needs root — and then
# re-execs itself as nodejs. The application process never runs as root; see
# docker-entrypoint.sh. Setting USER here instead would leave the volume
# unwritable and every upload failing with EACCES.
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
