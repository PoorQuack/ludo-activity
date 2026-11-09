#!/usr/bin/env bash
# The way to update Ludo on the VM. Backs up the save file, pulls, builds, tests, and goes live
# without kicking anyone out of their game:
#  - The new page is built next to the live one (dist.new) and swapped in at the end, so nobody
#    loads a half-built page. Old asset files are kept a week for tabs still on the old page.
#  - The server only restarts when server code changed (server/, shared/, packages). A page-only
#    update (look, sounds, client/) goes live with no restart at all: players get it on refresh.
#  - When it does restart, open games are saved and picked back up (see ROOMS_FILE in
#    server/index.js). Players get a heads-up in the game chat and on screen ~8s before
#    (ANNOUNCE_WAIT=seconds to change it), see "Updating the game…" for a moment, and carry on.
# Rolls back if anything fails.
#
#   bash scripts/deploy.sh                  normal update
#   bash scripts/deploy.sh --when-quiet     if the server must restart, first wait until nobody is
#                                           mid-game (checks every 30s, gives up after 60 min)
#   FORCE_RESTART=1 bash scripts/deploy.sh  restart even if only the page changed (e.g. after editing .env)
set -euo pipefail
cd "$(dirname "$0")/.."

WHEN_QUIET=""
for arg in "$@"; do
  case "$arg" in
    --when-quiet) WHEN_QUIET=1 ;;
    *) echo "Unknown option: $arg (see the top of scripts/deploy.sh)" >&2; exit 2 ;;
  esac
done
QUIET_WAIT_MIN="${QUIET_WAIT_MIN:-60}"
QUIET_POLL_SEC="${QUIET_POLL_SEC:-30}"

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

# How many players are in a game right now (from /api/status; on an older server without it,
# a rougher count of open connections to the game).
players_in_games() {
  local s n
  if s=$(curl -fsS --max-time 5 "http://localhost:${PORT}/api/status" 2>/dev/null); then
    n=$(printf '%s' "$s" | grep -o '"playersInGames":[0-9]*' | cut -d: -f2 || true)
    if [ -n "$n" ]; then echo "$n"; return; fi
  fi
  ss -Htn state established "( sport = :${PORT} )" 2>/dev/null | wc -l
}

wait_quiet() {
  local deadline=$((SECONDS + QUIET_WAIT_MIN * 60)) n
  while :; do
    n=$(players_in_games)
    if [ "$n" -eq 0 ]; then echo "Quiet: nobody is mid-game, restarting now"; return 0; fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "!!! Still $n player(s) mid-game after ${QUIET_WAIT_MIN} min — not restarting. Try again later." >&2
      return 1
    fi
    echo "$n player(s) mid-game — checking again in ${QUIET_POLL_SEC}s (Ctrl+C to give up)"
    sleep "$QUIET_POLL_SEC"
  done
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

# --when-quiet: before anything goes live, wait until a restart wouldn't interrupt anyone.
if [ -n "$NEED_RESTART" ] && [ -n "$WHEN_QUIET" ] && ! wait_quiet; then
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

# Warn whoever is online first: a line in every game's chat and a note on screen, then a few
# seconds for them to read it. (An older server without /api/admin/announce just skips this.)
if curl -fsS --max-time 5 -X POST "http://localhost:${PORT}/api/admin/announce" >/dev/null 2>&1; then
  echo "Told players an update is coming, restarting in ${ANNOUNCE_WAIT:-8}s"
  sleep "${ANNOUNCE_WAIT:-8}"
fi

# pm2 sends SIGINT: the server saves open games to data/rooms.json and the new one loads them.
# (It also tells open pages it's restarting, and they reconnect on their own.)
if ! { pm2 restart ludo --update-env && wait_healthy; }; then
  rollback live
  exit 1
fi
echo "Deploy ok — server restarted, open games carried over (http://localhost:${PORT}/healthz is up)"
