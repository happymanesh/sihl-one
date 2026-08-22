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

# Take ownership of the persistent volume, then stop being root.
#
# Railway mounts its volumes owned by root. The application runs as uid 1001, so
# it could not even create its own storage directory inside the mount: every
# upload died with `EACCES: permission denied, mkdir '/data/storage'` — check-in
# photos and client documents alike. The directory cannot be created at build
# time either, because the mount replaces whatever the image had there.
#
# This is the only operation in the whole container that needs root, so it runs
# first and privileges are dropped immediately afterwards by re-execing this
# same script as nodejs. Everything below — migrations, seeds, the API itself —
# runs unprivileged. Guarded on `id -u` so the second pass falls straight
# through, and so the script still works if the platform starts it as nodejs.
if [ "$(id -u)" = "0" ]; then
  if [ -n "$STORAGE_LOCAL_ROOT" ]; then
    echo "[entrypoint] Preparing $STORAGE_LOCAL_ROOT for uid 1001…"
    mkdir -p "$STORAGE_LOCAL_ROOT"
    # Recursive: a directory created by an earlier root-only run is still
    # root-owned, and would keep failing for everything written underneath it.
    chown -R nodejs:nodejs "$STORAGE_LOCAL_ROOT"
  fi

  echo "[entrypoint] Dropping to user nodejs."
  exec su-exec nodejs "$0" "$@"
fi

echo "[entrypoint] Applying database migrations…"
# Run from apps/api: the config's schema and migrations paths are relative to
# the working directory.
cd apps/api
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
