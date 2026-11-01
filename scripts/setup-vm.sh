#!/usr/bin/env bash
# One-time setup of Ludo on a Linux VM (Ubuntu or Oracle Linux), next to anything else
# already running there. Run it from inside the cloned folder:
#
#   bash scripts/setup-vm.sh
#
# It only adds things: its own folder, its own pm2 apps ("ludo" and "ludo-tunnel") and a
# free port. It never upgrades an existing Node.js, so other apps on the VM keep working.
# Safe to run again: it updates the code and restarts Ludo.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- Node.js ----------
say "Checking Node.js"
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 18 ] || die "Node.js $(node -v) is installed but Ludo needs 18+. Not upgrading it, because other apps on this VM may rely on it. Ask before changing it."
  echo "Using existing Node.js $(node -v)"
else
  echo "Node.js not found, installing Node 22"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf install -y nodejs
  else
    die "Couldn't find apt or dnf to install Node.js."
  fi
fi

# ---------- swap (only if there is none) ----------
if [ "$(free -m | awk '/^Swap:/ {print $2}')" -eq 0 ]; then
  say "Adding 2 GB of swap (this VM has none; it helps a 1 GB VM run two apps)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ---------- pm2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  say "Installing pm2 (keeps Ludo running and restarts it after crashes/reboots)"
  sudo npm install -g pm2
fi

# ---------- app ----------
say "Installing Ludo's packages and building it"
npm ci
npm run build

if [ ! -f .env ]; then
  say "Creating .env (your Discord app's details, from the Developer Portal → OAuth2)"
  read -rp "Discord Client ID: " client_id
  read -rsp "Discord Client Secret (hidden as you type): " client_secret
  echo
  # First free port from 3001 up, so it can't clash with other apps
  port=3001
  while ss -ltn | awk '{print $4}' | grep -qE "[:.]$port\$"; do port=$((port + 1)); done
  umask 077
  cat > .env <<EOF
DISCORD_CLIENT_ID=$client_id
DISCORD_CLIENT_SECRET=$client_secret
PORT=$port
ALLOW_GUESTS=false
FREE_SHOP=false
EOF
  echo "Saved .env (only readable by you). Ludo will use port $port."
fi
port=$(grep -E '^PORT=' .env | cut -d= -f2)
port=${port:-3001}

say "Starting Ludo with pm2 as \"ludo\""
if pm2 describe ludo >/dev/null 2>&1; then pm2 restart ludo --update-env; else pm2 start ecosystem.config.cjs; fi

# ---------- HTTPS tunnel ----------
if ! command -v cloudflared >/dev/null 2>&1; then
  say "Installing cloudflared (gives the game an HTTPS address for Discord)"
  arch=$(uname -m)
  case "$arch" in
    x86_64) cf=amd64 ;;
    aarch64 | arm64) cf=arm64 ;;
    *) die "Unknown CPU type $arch for cloudflared." ;;
  esac
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$cf.deb"
    sudo dpkg -i /tmp/cloudflared.deb
  else
    [ "$cf" = amd64 ] && rpm=x86_64 || rpm=aarch64
    curl -fsSL -o /tmp/cloudflared.rpm "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$rpm.rpm"
    sudo rpm -Uvh /tmp/cloudflared.rpm
  fi
fi

say "Starting the tunnel with pm2 as \"ludo-tunnel\""
pm2 delete ludo-tunnel >/dev/null 2>&1 || true
pm2 start "$(command -v cloudflared)" --name ludo-tunnel -- tunnel --no-autoupdate --url "http://localhost:$port"

# Keep both running after reboots (this doesn't change other pm2 apps)
pm2 save
startup=$(pm2 startup 2>/dev/null | grep -E '^sudo ' || true)
[ -n "$startup" ] && eval "$startup" >/dev/null

say "Waiting for the tunnel address"
url=""
for _ in $(seq 1 30); do
  url=$(pm2 logs ludo-tunnel --lines 100 --nostream 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$url" ] && break
  sleep 1
done

if [ -n "$url" ]; then
  printf '\n\033[1;32mDone! Ludo is running.\033[0m\n'
  echo "In the Discord Developer Portal → Activities → URL Mappings, set the root (/) target to:"
  printf '\n    \033[1m%s\033[0m\n\n' "${url#https://}"
  echo "If the VM restarts, get the new address with:  bash scripts/tunnel-url.sh"
else
  echo "Ludo is running, but the tunnel address didn't show up yet. Run: bash scripts/tunnel-url.sh"
fi
