# 🎲 Ludo — a Discord Activity

Multiplayer Ludo that runs inside Discord as an Activity.

- **Modes:** 2 players, 4 players, or 6 players on a hexagon board. Bots can fill empty seats.
- **Main menu** with Play, Shop and How to play.
- **Coins and shop:** players earn coins by finishing games and spend them on token skins, dice skins, board themes and emotes. Coins are saved on the server in `data/profiles.json`.

- **Server:** Node.js, Express and WebSockets. The server enforces the rules, so players can't cheat.
- **Client:** Plain JavaScript drawing on a canvas, bundled with Vite and using the Discord Embedded App SDK.

## Rules

- Roll a **6** to move a token out of base.
- Rolling a 6, capturing a token, or getting a token home gives you **another turn**.
- Landing on an opponent sends their token back to base. If two tokens share the square, only one goes back. The ★ squares and the coloured start squares are **safe**, so nobody can be captured there.
- You need the **exact roll** to reach home.
- You have **30 seconds** per turn. After that, the game moves for you. Run out of time **3 turns in a row** and you're removed from the game (as if you surrendered). If a player disconnects, a bot plays for them until they come back.

---

## 1. Run it on your PC

You need **Node.js 18 or newer** (https://nodejs.org).

```bash
npm install
cp .env.example .env        # on Windows: copy .env.example .env
npm run build
npm start
```

Open http://localhost:3001. To test multiplayer in your browser, open a second tab. You can name each tab with `?name=Alice`.

## 2. Create the Discord app

1. Go to https://discord.com/developers/applications and click **New Application**.
2. **OAuth2** page:
   - Copy the **Client ID** and put it in `.env` as `DISCORD_CLIENT_ID`.
   - Click **Reset Secret**, copy the secret, and put it in `.env` as `DISCORD_CLIENT_SECRET`.
   - Under **Redirects**, add `https://127.0.0.1`. Discord requires at least one redirect, but this app never uses it.
3. **Installation** page: make sure **Guild Install** is enabled.
4. **Activities → Settings**: turn on **Enable Activities**.
5. Restart the server (`npm start`) so it reads the new `.env`.

## 3. Get an HTTPS URL for your PC

Discord can only load an Activity over HTTPS, so you need a tunnel. A Cloudflare tunnel is free and needs no account:

```bash
# install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# Windows: winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3001
```

The command prints a URL like `https://random-words.trycloudflare.com`.

1. In the Developer Portal, go to **Activities → URL Mappings**.
2. Set the **Root Mapping** (`/`) target to `random-words.trycloudflare.com`. Leave out `https://`.
3. Save.

> The quick-tunnel URL changes every time you restart `cloudflared`, so you'll need to update the mapping each time. The VM setup below fixes this.

## 4. Play in Discord

1. Join a voice channel and click the 🚀 **Activities** button.
2. Find your app and launch it.
3. Ask friends in the same channel to join the Activity.

Each Activity session gets its own game. The first person in is the **host**: they can add bots and start the game.

> If friends can't see or launch the app while it's still in development, add them under **App Testers** in the Developer Portal.

---

## 5. Push to GitHub

`.env` is listed in `.gitignore`, so your secret stays private. Check this before your first push.

```bash
git init
git add .
git commit -m "Ludo Discord Activity"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/ludo-activity.git
git push -u origin main
```

If you ever commit the secret by accident, click **Reset Secret** in the Developer Portal right away.

---

## 6. Host on an Oracle Cloud VM (1 GB, Ubuntu)

### Basics

```bash
# 2 GB of swap: makes the 1 GB VM much more comfortable
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node.js 22 + git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Get the code
git clone https://github.com/YOUR_NAME/ludo-activity.git
cd ludo-activity
npm ci
npm run build
cp .env.example .env && nano .env     # fill in the ID and secret, and set ALLOW_GUESTS=false

# Keep it running and start it after reboots
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints
```

The server uses roughly 50–80 MB of RAM.

Player coins and purchases live in `data/profiles.json` (git ignores it). Back that file up if you rebuild the VM. Set `DATA_FILE` in `.env` to store it somewhere else.

### HTTPS on the VM: choose one

**Option A: Cloudflare named tunnel (recommended if you own a domain on Cloudflare).**
You don't need to open any ports, and the URL never changes.

```bash
# install cloudflared: https://pkg.cloudflare.com/
cloudflared tunnel login
cloudflared tunnel create ludo
cloudflared tunnel route dns ludo ludo.yourdomain.com
cloudflared tunnel run --url http://localhost:3001 ludo
# to run it as a service: sudo cloudflared service install
```

Then set the Root Mapping in the Developer Portal to `ludo.yourdomain.com`.

**Option B: free DuckDNS subdomain + Caddy (no domain needed).**

1. Get a free name at https://www.duckdns.org and point it at the VM's public IP.
2. In Oracle Cloud, go to **VCN → Security List** and add ingress rules for TCP **80** and **443**.
3. Oracle's Ubuntu images also block these ports in iptables. Open them:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
4. Install Caddy (https://caddyserver.com/docs/install#debian-ubuntu-raspbian) and put this in `/etc/caddy/Caddyfile`:
   ```
   yourname.duckdns.org {
       reverse_proxy localhost:3001
   }
   ```
5. Run `sudo systemctl reload caddy`. Caddy gets an HTTPS certificate automatically.
6. Set the Root Mapping to `yourname.duckdns.org`.

### Updating

```bash
cd ludo-activity && git pull && npm ci && npm run build && pm2 restart ludo
```

---

## Project layout

```
client/      main.js = screens + animations, renderer.js = canvas drawing, shop-ui.js, skins.js
server/      index.js = HTTP + WebSocket server, room.js = game flow, rules.js = Ludo rules + bot,
             store.js = saved coins and shop items
shared/      board.js = 4- and 6-arm board geometry, shop.js = shop items, prices and rewards
test/        rule tests: npm test
```
