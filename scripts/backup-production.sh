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

# Resolve the CLI rather than trusting PATH. Task Scheduler runs with a much
# barer environment than a login shell, and the npm global bin directory is not
# on it — the first scheduled run died with `railway: command not found` after
# the same script had just succeeded by hand.
RAILWAY="${RAILWAY_BIN:-}"
# A path handed in from cmd.exe arrives as C:\Users\... , which bash cannot
# resolve. Translate before testing it, or the check below reports the CLI
# missing when it is sitting right there.
if [ -n "$RAILWAY" ] && command -v cygpath >/dev/null 2>&1; then
  RAILWAY="$(cygpath -u "$RAILWAY" 2>/dev/null || printf '%s' "$RAILWAY")"
fi
if [ -n "$RAILWAY" ] && [ ! -f "$RAILWAY" ]; then
  echo "    RAILWAY_BIN=$RAILWAY does not exist; falling back to PATH" >&2
  RAILWAY=""
fi
if [ -z "$RAILWAY" ]; then
  if command -v railway >/dev/null 2>&1; then
    RAILWAY="$(command -v railway)"
  elif [ -f "$APPDATA/npm/railway" ]; then
    RAILWAY="$APPDATA/npm/railway"
  elif [ -f "$HOME/AppData/Roaming/npm/railway" ]; then
    RAILWAY="$HOME/AppData/Roaming/npm/railway"
  else
    echo "!!! railway CLI not found. Set RAILWAY_BIN to its full path." >&2
    exit 127
  fi
fi

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
  "$RAILWAY" ssh --project "$PROJECT" --environment "$ENVIRONMENT" \
    --service "$DB_SERVICE" -i "$SSH_KEY" "$1" </dev/null
}

mkdir -p "$DEST_DIR"

echo "==> Dumping ${ENVIRONMENT} inside the container"
REMOTE_SHA="$(rsh "pg_dump --format=custom --compress=9 --file=${REMOTE} && sha256sum ${REMOTE} | cut -d' ' -f1" | tr -d '\r' | tail -1)"
echo "    remote sha256 ${REMOTE_SHA}"

echo "==> Downloading"
"$RAILWAY" service files --project "$PROJECT" --environment "$ENVIRONMENT" --service "$DB_SERVICE" \
  download --overwrite "$REMOTE" "$(cygpath -w "$LOCAL" 2>/dev/null || echo "$LOCAL")" >/dev/null

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

# Prune, but never to nothing. A run that somehow produced only broken archives
# should not also delete the last good one, so the newest MIN_KEEP files survive
# regardless of age.
RETAIN_DAYS="${RETAIN_DAYS:-30}"
MIN_KEEP="${MIN_KEEP:-7}"
mapfile -t ALL < <(ls -1t "${DEST_DIR}"/sihl-prod-*.dump 2>/dev/null || true)
if [ "${#ALL[@]}" -gt "$MIN_KEEP" ]; then
  for old in "${ALL[@]:$MIN_KEEP}"; do
    if [ -n "$(find "$old" -mtime +"$RETAIN_DAYS" 2>/dev/null)" ]; then
      rm -f "$old"
      echo "    pruned $(basename "$old")"
    fi
  done
fi

# A one-line ledger the scheduled task appends to. The point is that a silent
# failure is visible the next morning without reading a whole log.
printf '%s\tOK\t%s\t%s\n' "$(date -Iseconds)" "$(basename "$LOCAL")" "$LOCAL_SHA" >> "${DEST_DIR}/backup-log.tsv"

echo
echo "Backup: ${LOCAL}"
echo "sha256: ${LOCAL_SHA}"
echo
echo "To restore into a fresh database:"
echo "  pg_restore --dbname=<target> --no-owner --exit-on-error '${LOCAL}'"
