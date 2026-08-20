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

# Run from apps/api: the config's schema and migrations paths are relative to
# the working directory.
cd apps/api

# Recovery hatch for a migration that failed part-way.
#
# Prisma wraps each migration in a transaction, so a failure leaves the schema
# untouched but writes a "failed" row that blocks every later migration with
# P3009. Marking it rolled back is the documented fix, and without this the only
# way to run it is a shell inside the container.
#
# Set to the migration name, deploy once, then unset. It is deliberately not a
# boolean: naming the migration means you have looked at which one failed.
if [ -n "$MIGRATE_RESOLVE_ROLLED_BACK" ]; then
  echo "[entrypoint] Marking $MIGRATE_RESOLVE_ROLLED_BACK as rolled back…"
  # Non-fatal on purpose. Once the migration has been fixed and applied, this
  # call fails — there is nothing left to roll back — and with `set -e` a flag
  # somebody forgot to clear would then stop the service from booting at all.
  # A recovery hatch must not become an outage.
  ../../node_modules/.bin/prisma migrate resolve \
    --rolled-back "$MIGRATE_RESOLVE_ROLLED_BACK" \
    --config prisma.config.production.mjs \
    || echo "[entrypoint] Nothing to roll back — clear MIGRATE_RESOLVE_ROLLED_BACK."
fi

echo "[entrypoint] Applying database migrations…"
../../node_modules/.bin/prisma migrate deploy --config prisma.config.production.mjs
echo "[entrypoint] Migrations applied."

# One-off data tasks, each behind its own flag and each off by default. They run
# here rather than from a developer's machine so the database never needs to be
# exposed to the public internet for an afternoon's setup.
#
# Turn a flag on, let one boot happen, turn it straight back off. Both scripts
# are safe to repeat — the seed upserts, and the bootstrap skips people who
# already exist — but leaving a flag on means re-running it on every restart.
if [ "$SEED_ON_BOOT" = "true" ]; then
  echo "[entrypoint] SEED_ON_BOOT=true — loading the demo book…"
  NODE_ENV=development ../../node_modules/.bin/tsx prisma/seed.ts
  echo "[entrypoint] Seed finished."
fi

if [ "$BOOTSTRAP_TEAM_ON_BOOT" = "true" ]; then
  echo "[entrypoint] BOOTSTRAP_TEAM_ON_BOOT=true — creating the team…"
  ../../node_modules/.bin/tsx prisma/bootstrap-team.ts --apply
  echo "[entrypoint] Bootstrap finished. Temporary passwords are above — turn"
  echo "[entrypoint] this flag off, and treat these logs as sensitive."
fi

cd /app
echo "[entrypoint] Starting API…"

# exec so the API becomes PID 1's direct child: tini forwards SIGTERM to it and
# Nest's shutdown hooks run, draining in-flight requests instead of cutting them
# off mid-transaction.
exec node apps/api/dist/main.js
