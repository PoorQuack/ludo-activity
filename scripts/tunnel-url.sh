#!/usr/bin/env bash
# Prints the current HTTPS address of the Ludo tunnel on the VM.
# It changes when the tunnel restarts (e.g. after a reboot): put the new one in
# Discord Developer Portal → Activities → URL Mappings (root "/", without https://).
url=$(pm2 logs ludo-tunnel --lines 200 --nostream 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
if [ -n "$url" ]; then
  echo "${url#https://}"
else
  echo "No tunnel address found. Is it running? Try: pm2 restart ludo-tunnel" >&2
  exit 1
fi
