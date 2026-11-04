#!/usr/bin/env bash
# The way to update Ludo on the VM. Backs up the save file, pulls, builds, tests, and goes live
# without kicking anyone out of their game:
#  - The new page is built next to the live one (dist.new) and swapped in at the end, so nobody
#    loads a half-built page. Old asset files are kept a week for tabs still on the old page.
#  - The server only restarts when server code changed (server/, shared/, packages). A page-only
#    update (look, sounds, client/) goes live with no restart at all: players get it on refresh.
#  - When it does restart, open games are saved and picked back up (see ROOMS_FILE in
#    server/index.js): players see "Reconnecting…" for a moment and carry on.
# Rolls back if anything fails.
#
#   bash scripts/deploy.sh                  normal update
#   FORCE_RESTART=1 bash scripts/deploy.sh  restart even if only the page changed (e.g. after editing .env)
set -euo pipefail
cd "$(dirname "$0")/.."

read_env() {
  local v
  v=$(grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
  printf '%s' "$v"
}

PORT="$(read_env PORT)"; PORT="${PORT:-3001}"
DATA_FILE="$(read_env DATA_FILE)"; DATA_FILE="${DATA_FILE:-data/profiles.json}"
export DATA_FILE

# Builds the page into dist.new (the live dist/ is untouched until swap_dist).
# Every step checks itself: bash ignores `set -e` inside a function called from an `if`.
build_dist() {
  rm -rf dist.new
  npm run build -- --outDir ../dist.new --emptyOutDir || return 1
  [ -f dist.new/index.html ] || { echo "!!! The build made no index.html" >&2; return 1; }
  # Keep the previous build's files (names are hashed, so nothing clashes) for players whose
  # tab still has the old page open; drop ones older than a week.
  if [ -d dist/assets ] && [ -d dist.new/assets ]; then
    cp -rnp dist/assets/. dist.new/assets/ || return 1
    find dist.new/assets -type f -mtime +7 -delete || true
  fi
}

# Puts dist.new live: two renames, a few milliseconds apart. Never leaves the site without a page.
swap_dist() {
  [ -f dist.new/index.html ] || { echo "!!! No finished build to put live" >&2; return 1; }
  rm -rf dist.old
  if [ -d dist ]; then mv dist dist.old || return 1; fi
  if ! mv dist.new dist; then
    if [ -d dist.old ]; then mv dist.old dist; fi
    return 1
  fi
  rm -rf dist.old
}

wait_healthy() {
  for _ in $(seq 1 20); do
    if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null; then return 0; fi
    sleep 1
  done
  echo "!!! Server did not answer /healthz within 20s" >&2
  return 1
}

bash scripts/backup.sh pre-deploy

OLD="$(git rev-parse HEAD)"
git pull --ff-only
NEW="$(git rev-parse HEAD)"
CHANGED="$(git diff --name-only "$OLD" "$NEW")"

if [ -z "$CHANGED" ] && [ -z "${FORCE_RESTART:-}" ]; then
  echo "Already up to date — nothing to do"
  exit 0
fi

NEED_INSTALL=""
if [ ! -d node_modules ] || grep -qE '^package(-lock)?\.json$' <<<"$CHANGED"; then NEED_INSTALL=1; fi
NEED_RESTART="${FORCE_RESTART:-}"
if grep -qE '^(server/|shared/|package(-lock)?\.json$|ecosystem\.config\.cjs$)' <<<"$CHANGED"; then NEED_RESTART=1; fi

rollback() {
  echo "!!! Deploy failed — rolling back to $OLD" >&2
  git reset --hard "$OLD" # .env and data/ are untracked, this can't touch them
  rm -rf dist.new
  if [ -n "$NEED_INSTALL" ]; then npm ci; fi
  if [ -n "$1" ]; then # the bad version went live: put the old one back
    build_dist && swap_dist
    if [ -n "$NEED_RESTART" ]; then pm2 restart ludo --update-env || true; fi
  fi
}

# Everything that can fail before players see any change.
# (tests get 5 minutes: a test that hangs must fail the deploy, not stall it)
if ! { { [ -z "$NEED_INSTALL" ] || npm ci; } && build_dist && timeout 300 npm test; }; then
  rollback ""
  exit 1
fi

if ! swap_dist; then
  rollback ""
  exit 1
fi
if [ -z "$NEED_RESTART" ]; then
  echo "Deploy ok — page-only update, live without a restart (players get it on refresh)"
  exit 0
fi

# pm2 sends SIGINT: the server saves open games to data/rooms.json and the new one loads them.
if ! { pm2 restart ludo --update-env && wait_healthy; }; then
  rollback live
  exit 1
fi
echo "Deploy ok — server restarted, open games carried over (http://localhost:${PORT}/healthz is up)"
