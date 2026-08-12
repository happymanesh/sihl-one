#!/bin/sh
#
# Apply migrations, then hand the process over to the API.
#
# This lives in the image rather than in a platform's "start command" field for
# two reasons: it is version-controlled alongside the code it migrates, and it
# does not depend on whether a given platform interprets that field through a
# shell. The image entrypoint is tini, which execs its arguments directly, so a
# "migrate && start" string passed as a command would be handed to the binary
# verbatim and fail before writing a single log line.
set -e

echo "[entrypoint] Applying database migrations…"
# Run from apps/api: the config's schema and migrations paths are relative to
# the working directory.
cd apps/api
../../node_modules/.bin/prisma migrate deploy --config prisma.config.production.mjs
cd /app
echo "[entrypoint] Migrations applied. Starting API…"

# exec so the API becomes PID 1's direct child: tini forwards SIGTERM to it and
# Nest's shutdown hooks run, draining in-flight requests instead of cutting them
# off mid-transaction.
exec node apps/api/dist/main.js
