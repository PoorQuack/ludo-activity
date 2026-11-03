#!/usr/bin/env bash
# Backs up the profile save file next to itself: <data dir>/backups/profiles-<UTC ts>[-label].json
# Keeps the newest 60. If <data dir>/r2.env exists and rclone is installed, also
# uploads a copy to R2 — a failed upload never fails the local backup.
set -euo pipefail
cd "$(dirname "$0")/.."

# Reads NAME from .env without executing it (the file also holds secrets).
read_env() {
  local v
  v=$(grep -E "^$1=" "${2:-.env}" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
  printf '%s' "$v"
}

LABEL="${1:-}"
DATA_FILE="${DATA_FILE:-$(read_env DATA_FILE)}"
DATA_FILE="${DATA_FILE:-data/profiles.json}"

if [ ! -f "$DATA_FILE" ]; then
  echo "No save file at $DATA_FILE — nothing to back up"
  exit 0
fi

dir=$(dirname "$DATA_FILE")
mkdir -p "$dir/backups"
out="$dir/backups/profiles-$(date -u +%Y%m%d-%H%M%S)${LABEL:+-$LABEL}.json"
cp "$DATA_FILE" "$out"
echo "Backup: $out"

# Keep only the newest 60 backups.
ls -1t "$dir/backups"/profiles-*.json 2>/dev/null | tail -n +61 | xargs -r rm -f

# Optional off-VM copy: drop an r2.env (R2_BUCKET=...) next to the data file and
# install rclone, and every backup is also uploaded. Not required.
if [ -f "$dir/r2.env" ] && command -v rclone >/dev/null 2>&1; then
  R2_BUCKET="$(read_env R2_BUCKET "$dir/r2.env")"
  if [ -n "$R2_BUCKET" ]; then
    if rclone copyto "$out" "r2:${R2_BUCKET}/daily/$(basename "$out")"; then
      echo "Uploaded to r2:${R2_BUCKET}/daily/$(basename "$out")"
    else
      echo "rclone upload failed — local backup kept" >&2
    fi
  fi
fi
