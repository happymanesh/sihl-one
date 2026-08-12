# syntax=docker/dockerfile:1.7
#
# Production image for the SIHL ONE web app.
#
# Mirrors the API image: multi-stage, non-root, tini as PID 1. The web app is a
# long-running Next server (Server Components, server actions, middleware), not
# a static export, so it needs a real Node process.

# --- Stage 1: install -------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --ignore-scripts

# --- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, not
# read at runtime. This has to be an ARG or the browser bundle ships pointing at
# whatever the fallback is, and every client-side call 404s against the wrong
# origin.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build -w @sihl-one/contracts \
 && npm run build -w @sihl-one/web \
 && npm prune --omit=dev

# --- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache tini
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nodejs -G nodejs

# Copied wholesale rather than cherry-picked: Next resolves a long tail of files
# at runtime (build manifests, server chunks, the transpiled workspace package),
# and a missing one surfaces as a 500 on one route rather than a build error.
COPY --from=build --chown=nodejs:nodejs /app ./

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# Honour the platform's PORT; fall back to 3000 for a plain `docker run`.
CMD ["sh", "-c", "npx next start apps/web -p ${PORT:-3000}"]
