#!/usr/bin/env bash
# Testing only: a player starts every turn with two 6s (then a normal roll) on the running server.
# Lasts 60 minutes unless you say otherwise, and a server restart clears it. Games where it
# kicked in pay no coins or leaderboard points (the result screen says it was a test game).
# Run it on the VM:
#
#   bash scripts/rig-dice.sh <discord user id> [minutes]     turn it on (default 60 minutes)
#   bash scripts/rig-dice.sh <discord user id> off           back to normal dice
#   bash scripts/rig-dice.sh                                 who is rigged right now
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
PORT="${PORT:-3001}"
URL="http://localhost:${PORT}/api/admin/rig"

if [ $# -eq 0 ]; then
  curl -fsS -X POST "$URL" -H 'Content-Type: application/json' -d '{}' && echo
elif [ "${2:-}" = "off" ]; then
  curl -fsS -X POST "$URL" -H 'Content-Type: application/json' -d "{\"userId\":\"$1\",\"off\":true}" && echo
else
  curl -fsS -X POST "$URL" -H 'Content-Type: application/json' -d "{\"userId\":\"$1\",\"minutes\":${2:-60}}" && echo
fi
