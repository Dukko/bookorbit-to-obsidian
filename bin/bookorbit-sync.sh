#!/usr/bin/env bash
#
# Cron wrapper for BookOrbit → Obsidian sync.
#
# - Loads .env from the project root (exported vars win).
# - Runs the bundled, dependency-free script (dist/sync.mjs).
# - Guards against overlapping runs (flock, with a portable fallback).
# - Appends timestamped output to a log file; exit code 0 on success,
#   nonzero on failure so cron can email you / alert.
#
# Crontab (hourly):
#   0 * * * * /DATA/projects/bookorbit-to-obsidian/bin/bookorbit-sync.sh
#
# Optional env overrides:
#   BOOKORBIT_SYNC_LOG   log file path          (default: <root>/logs/bookorbit-sync.log)
#   BOOKORBIT_SYNC_FLAGS extra flags for sync    (e.g. "--only=overview,heatmap")
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${BOOKORBIT_SYNC_LOG:-$ROOT/logs/bookorbit-sync.log}"
FLAGS="${BOOKORBIT_SYNC_FLAGS:-}"

# --- node -------------------------------------------------------------------
# Prefer an explicit NODE_BIN, then PATH, then a few common install locations.
if [[ -n "${NODE_BIN:-}" && -x "$NODE_BIN" ]]; then
  NODE="$NODE_BIN"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for candidate in "$HOME/.local/node/bin/node" /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE="$candidate"
      break
    fi
  done
fi
if [[ -z "${NODE:-}" ]]; then
  echo "$(date -Is) ERROR: node not found — install Node.js >= 18 or set NODE_BIN=/path/to/node" >&2
  exit 1
fi

# --- .env ---------------------------------------------------------------
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# --- log dir -----------------------------------------------------------------
mkdir -p "$(dirname "$LOG")"

# --- single-instance lock ------------------------------------------------
LOCK_DIR="$ROOT/.sync.lockdir"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$ROOT/.sync.lock"
  if ! flock -n 9; then
    echo "$(date -Is) SKIPPED: another sync is already running" >>"$LOG"
    exit 0
  fi
else
  # Portable fallback (macOS): mkdir is atomic.
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$(date -Is) SKIPPED: another sync is already running" >>"$LOG"
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi

# --- run ------------------------------------------------------------------
BIN="$ROOT/dist/sync.mjs"

if [[ ! -f "$BIN" ]]; then
  echo "$(date -Is) ERROR: $BIN missing — run 'npm install && npm run build' first" >>"$LOG"
  exit 1
fi

echo "== $(date -Is) start ==" >>"$LOG"
if (cd "$ROOT" && "$NODE" "$BIN" $FLAGS --quiet) >>"$LOG" 2>&1; then
  echo "== $(date -Is) done ok ==" >>"$LOG"
else
  code=$?
  echo "== $(date -Is) FAILED (exit $code) ==" >>"$LOG"
  exit "$code"
fi