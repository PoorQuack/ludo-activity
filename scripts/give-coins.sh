#!/usr/bin/env bash
# Gives coins to players on the running server (no restart; their coin count updates live).
# Run it on the VM:
#
#   bash scripts/give-coins.sh <discord user id> <amount> [<another user id> ...]
#   bash scripts/give-coins.sh 1297913126418645033 1000000
#   bash scripts/give-coins.sh 1297913126418645033 -500        (takes 500 away, never below 0)
#
# Several ids can share one amount: give-coins.sh 1000000 id1 id2 also works (amount first).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
PORT="${PORT:-3001}"

if [ $# -lt 2 ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

# amount first (give-coins.sh 1000000 id1 id2) or last (give-coins.sh id1 id2 1000000)
if [[ "$1" =~ ^-?[0-9]{1,10}$ ]] && ! [[ "$1" =~ ^[0-9]{11,}$ ]]; then
  amount="$1"; shift; ids=("$@")
else
  amount="${!#}"; ids=("${@:1:$#-1}")
fi

for id in "${ids[@]}"; do
  curl -fsS -X POST "http://localhost:${PORT}/api/admin/coins" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"${id}\",\"amount\":${amount}}" && echo
done
