#!/usr/bin/env bash
#
# Take a verified backup of the production database.
#
# Railway's managed backups are a Pro-plan feature and this project is on Hobby,
# so there is no automatic snapshot to fall back on. This is the replacement:
# pg_dump run inside the Postgres container itself, which means the dump is
# produced by the exact server version and never crosses the public internet.
# The database has no TCP proxy, and it should not get one just to be backed up.
#
# The dump is written outside the repository on purpose. It contains client
# names, mobile numbers and the full audit trail, and must never reach git.
#
# Usage:
#   scripts/backup-production.sh              # dump and verify
#   scripts/backup-production.sh --no-verify  # dump only, skip the restore test
#
# Prerequisites: railway CLI, logged in, with an SSH key registered
# (`railway ssh keys add`). Set SSH_KEY if yours is not the default below.

set -euo pipefail

PROJECT="${RAILWAY_PROJECT:-8c812c44-bfdb-4fc8-a259-14b13991d660}"
ENVIRONMENT="${RAILWAY_ENV:-production}"
DB_SERVICE="${DB_SERVICE:-Postgres}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/railway_sihl}"
DEST_DIR="${BACKUP_DIR:-/c/Projects/SIHL_backups}"
VERIFY=1
[ "${1:-}" = "--no-verify" ] && VERIFY=0

# Git Bash rewrites anything that looks like a Unix path into a Windows one,
# which turns a remote /tmp path into C:\Users\...\Temp and fails confusingly.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

STAMP="$(date +%Y%m%d-%H%M)"
REMOTE="/tmp/sihl-prod-${STAMP}.dump"
LOCAL="${DEST_DIR}/sihl-prod-${STAMP}.dump"

rsh() {
  railway ssh --project "$PROJECT" --environment "$ENVIRONMENT" \
    --service "$DB_SERVICE" -i "$SSH_KEY" "$1" </dev/null
}

mkdir -p "$DEST_DIR"

echo "==> Dumping ${ENVIRONMENT} inside the container"
REMOTE_SHA="$(rsh "pg_dump --format=custom --compress=9 --file=${REMOTE} && sha256sum ${REMOTE} | cut -d' ' -f1" | tr -d '\r' | tail -1)"
echo "    remote sha256 ${REMOTE_SHA}"

echo "==> Downloading"
railway service --project "$PROJECT" --environment "$ENVIRONMENT" --service "$DB_SERVICE" \
  files download --overwrite "$REMOTE" "$(cygpath -w "$LOCAL" 2>/dev/null || echo "$LOCAL")" >/dev/null

LOCAL_SHA="$(sha256sum "$LOCAL" | cut -d' ' -f1)"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "!!! checksum mismatch — the transfer is corrupt, not a usable backup" >&2
  echo "    remote ${REMOTE_SHA}" >&2
  echo "    local  ${LOCAL_SHA}" >&2
  exit 1
fi
echo "    checksum matches"

# A backup nobody has restored is a hypothesis. Restoring into a scratch
# database on the same server proves the archive is readable by the version that
# will have to read it, and costs about ten seconds. It never touches `railway`:
# a separate database is created, filled, counted and dropped.
if [ "$VERIFY" = "1" ]; then
  echo "==> Verifying the dump restores"
  rsh "createdb sihl_restore_verify && pg_restore --dbname=sihl_restore_verify --no-owner --exit-on-error ${REMOTE}" >/dev/null
  rsh 'for t in app_user lead activity task audit_log; do
         echo "    $t $(psql -At -d railway -c "select count(*) from $t") -> $(psql -At -d sihl_restore_verify -c "select count(*) from $t")";
       done' | tr -d '\r'
  rsh "dropdb sihl_restore_verify" >/dev/null
  echo "    scratch database dropped"
fi

# The container copy is PII sitting on a shared host with no reason to persist.
rsh "rm -f ${REMOTE}" >/dev/null

echo
echo "Backup: ${LOCAL}"
echo "sha256: ${LOCAL_SHA}"
echo
echo "To restore into a fresh database:"
echo "  pg_restore --dbname=<target> --no-owner --exit-on-error '${LOCAL}'"
