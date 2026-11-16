#!/usr/bin/env bash
# Posts an announcement to every player's inbox (live for anyone online; the rest see it next
# time they open the game). Run it on the VM:
#
#   bash scripts/announce.sh "Title" "The message (optional)"
#   bash scripts/announce.sh "New boards!" "The Crystal board and Dino tokens are in the shop."
#   bash scripts/announce.sh --delete <id>        (takes one down; the id is printed when posting)
#
# Accounts listed in ADMIN_IDS (.env, comma-separated Discord ids) can also post from the
# game itself: Inbox (the bell) -> Post an announcement.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
PORT="${PORT:-3001}"

if [ $# -lt 1 ]; then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

if [ "$1" = "--delete" ]; then
  body=$(node -e 'console.log(JSON.stringify({ delete: process.argv[1] }))' "${2:-}")
else
  body=$(node -e 'console.log(JSON.stringify({ title: process.argv[1], body: process.argv[2] || "" }))' "$1" "${2:-}")
fi
curl -fsS -X POST "http://localhost:${PORT}/api/admin/announce" -H 'Content-Type: application/json' -d "$body" && echo
