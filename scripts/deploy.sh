#!/usr/bin/env bash
# The way to update Ludo on the VM. Backs up the save file, pulls, rebuilds,
# restarts under pm2 and waits for /healthz — rolling back if anything fails.
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

bash scripts/backup.sh pre-deploy

OLD="$(git rev-parse HEAD)"
rollback() {
  echo "!!! Deploy failed — rolling back to $OLD" >&2
  git reset --hard "$OLD" # .env and data/ are untracked, this can't touch them
  npm ci
  npm run build
  pm2 restart ludo --update-env || true
}

git pull --ff-only

if ! { npm ci && npm run build && npm test && pm2 restart ludo --update-env; }; then
  rollback
  exit 1
fi

for _ in $(seq 1 20); do
  if curl -fsS "http://localhost:${PORT}/healthz" >/dev/null; then
    echo "Deploy ok — http://localhost:${PORT}/healthz is up"
    exit 0
  fi
  sleep 1
done

echo "!!! Server did not answer /healthz within 20s" >&2
rollback
exit 1
