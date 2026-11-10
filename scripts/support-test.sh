#!/usr/bin/env bash
# Checks that bug reports / feedback can reach your Discord DMs: sends you a test DM through the
# app's bot and prints what Discord answered. Run it on the VM:
#
#   bash scripts/support-test.sh                  send yourself a test DM
#   bash scripts/support-test.sh --send-waiting   send everything waiting for the daily feedback
#                                                 digest right now, and list the latest requests
#
# Needs DISCORD_BOT_TOKEN and SUPPORT_USER_ID in .env (see .env.example), and the server
# restarted after adding them (FORCE_RESTART=1 bash scripts/deploy.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '[:space:]' || true)
PORT="${PORT:-3001}"
if [ "${1:-}" = "--send-waiting" ]; then
  curl -fsS -X POST "http://localhost:${PORT}/api/admin/support-digest" && echo
  exit 0
fi
out=$(curl -fsS -X POST "http://localhost:${PORT}/api/admin/support-test")
echo "$out"
case "$out" in
  *'"ok":true'*) echo "✅ Test DM sent: check your Discord DMs." ;;
  *'not set up'*) echo "❌ Add DISCORD_BOT_TOKEN and SUPPORT_USER_ID to .env, then: FORCE_RESTART=1 bash scripts/deploy.sh" ;;
  *'50278'*|*'mutual guilds'*) echo "❌ The bot isn't in any server you're in: add it with OAuth2 -> URL Generator -> 'bot' in the Developer Portal, then run this again." ;;
  *'50007'*) echo "❌ Discord won't let the bot DM you: in that server's Privacy Settings, allow direct messages from server members." ;;
  *'401'*) echo "❌ Discord rejected the bot token: reset it in the Developer Portal (Bot -> Reset Token) and update .env." ;;
  *) echo "❌ Not sent: see the error above." ;;
esac
echo "Requests saved on the server so far: data/support.json"
