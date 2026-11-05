import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomDirectory } from './rooms.js';
import { ProfileStore } from './store.js';
import { Leaderboard } from './leaderboard.js';
import { QuestBook } from './quests.js';
import { TokenBucket, KeyedLimiter, TtlCache } from './limits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'profiles.json');
// Open rooms are written here when the server stops and read back when it starts, so an
// update (pm2 restart) doesn't end anyone's game: players reconnect and carry on.
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(path.dirname(DATA_FILE), 'rooms.json');
// Weekly and monthly leaderboards (scores, last winners, prizes paid), next to the profiles.
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(path.dirname(DATA_FILE), 'leaderboard.json');
// Today's daily quest progress (reset at midnight UTC).
const QUESTS_FILE = process.env.QUESTS_FILE || path.join(path.dirname(DATA_FILE), 'quests.json');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Guests = playing in a normal browser tab without Discord (handy for testing).
const ALLOW_GUESTS = (process.env.ALLOW_GUESTS ?? 'true') === 'true';
// For testing skins: every shop item costs 0 coins.
const FREE_SHOP = process.env.FREE_SHOP === 'true';
const ROOM_IDLE_MS = 2 * 60_000; // an empty room waits this long (for a refresh to rejoin) before closing
const LIST_EVERY_MS = 1000; // the room list in everyone's menu refreshes at most this often

const app = express();
app.use(express.json({ limit: '4kb' }));

// The VM only listens behind a Cloudflare tunnel, so this header is trustworthy there; locally it's absent.
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown';

// Abuse limits: messages per socket, connections per IP, logins (each calls Discord), token exchanges.
const MAX_MSG_BURST = 20;
const MSG_PER_SEC = 8;
const MAX_MSG_DROPS = 60; // ignored this many messages and the socket is cut
const SLOW_NOTICE_MS = 2000; // 'Slow down' is sent at most this often per socket
// Discord Activities route every player's traffic through Discord's proxy, which hides their IPs —
// so everyone arrives behind a handful of shared egress addresses. Per-IP numbers are a loose
// backstop against gross floods only; the real per-person limits are keyed on the user id below.
const MAX_SOCKETS_PER_IP = 200;
const MAX_SOCKETS_TOTAL = 1500;
const connLimiter = new KeyedLimiter({ max: 300, windowMs: 60_000 }); // new sockets per IP per minute
const helloLimiter = new KeyedLimiter({ max: 300, windowMs: 60_000 }); // hellos per IP per minute
const tokenLimiter = new KeyedLimiter({ max: 200, windowMs: 60_000 }); // token exchanges per IP per minute
const MAX_SOCKETS_PER_USER = 5;
const HELLO_TIMEOUT_MS = 15_000;
const socketsByIp = new Map(); // ip -> open socket count
// Verified Discord access tokens (hashed, never stored raw) so repeat hellos skip the Discord API.
const tokenCache = new TtlCache({ ttlMs: 10 * 60_000, maxEntries: 5000 });
setInterval(() => {
  connLimiter.prune();
  helloLimiter.prune();
  tokenLimiter.prune();
  tokenCache.prune();
}, 60_000).unref();

app.get('/api/config', (_req, res) => {
  res.json({ clientId: CLIENT_ID, allowGuests: ALLOW_GUESTS, freeShop: FREE_SHOP });
});

// Exchange the OAuth code from the Embedded App SDK for an access token.
app.post('/api/token', (req, res, next) => {
  if (!tokenLimiter.hit(clientIp(req))) return res.status(429).json({ error: 'Too many requests' });
  next();
}, async (req, res) => {
  try {
    const code = req.body?.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('Token exchange failed', data);
      return res.status(400).json({ error: 'Token exchange failed' });
    }
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));

// How busy the server is, for scripts/deploy.sh --when-quiet. Only answered on the VM itself:
// requests through the Cloudflare tunnel carry cf-connecting-ip and get a 404.
app.get('/api/status', (req, res) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!local || req.headers['cf-connecting-ip']) return res.status(404).end();
  res.json({ rooms: directory.rooms.size, ...activity(), uptimeSec: Math.round(process.uptime()) });
});

const dist = path.join(__dirname, '..', 'dist');
// The page itself is never cached, so players always get the newest version after an update.
// Built files have a hash in their name that changes with every build, so those can be kept.
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
app.use(
  express.static(dist, {
    setHeaders(res, file) {
      if (file.endsWith('.html') || file.endsWith('sounds.json')) noCache(res); // playlist edits must apply at once
      else if (file.includes(`${path.sep}sounds${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=604800'); // a week: sound names aren't hashed
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
app.get('*', (_req, res) => {
  noCache(res);
  res.sendFile(path.join(dist, 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const userSockets = new Map();
const store = new ProfileStore(DATA_FILE, { onChange: sendProfile, freeShop: FREE_SHOP });
const leaderboard = new Leaderboard(LEADERBOARD_FILE, { profiles: store, onAward: sendAwards });
setInterval(() => leaderboard.rollover(), 60_000).unref(); // pays out as soon as a week or month ends
// Finished daily quests add their points to the leaderboards.
const quests = new QuestBook(QUESTS_FILE, { onPoints: (userId, name, points) => leaderboard.addPoints(userId, name, points) });
const directory = new RoomDirectory({
  idleMs: ROOM_IDLE_MS,
  roomOptions: {
    profiles: store,
    onGameEnd: (results) => leaderboard.record(results),
    onStat: questProgress,
    onChange: (room) => {
      broadcast(room);
      listsChanged();
    },
  },
  onRemove: listsChanged,
});
const roomExtra = (id) => ({ onKick: (userId) => kickFromRoom(directory.get(id), userId) });

// Rooms saved by the last shutdown come back. The file is removed once read, so a room that
// somehow crashes the server can't be loaded over and over.
function restoreRooms() {
  if (!fs.existsSync(ROOMS_FILE)) return;
  try {
    const n = directory.restore(JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')), { extra: roomExtra });
    if (n) console.log(`Restored ${n} room${n === 1 ? '' : 's'} from before the restart`);
  } catch (err) {
    console.error(`Couldn't read saved rooms (${err.message}) — starting with none`);
  }
  try {
    fs.rmSync(ROOMS_FILE);
  } catch {
    // nothing to tidy up
  }
}

function saveRooms() {
  try {
    fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
    const tmp = `${ROOMS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(directory.save()));
    fs.renameSync(tmp, ROOMS_FILE); // all or nothing: never a half-written file
  } catch (err) {
    console.error(`Couldn't save rooms: ${err.message}`);
  }
}

function sendProfile(userId) {
  const msg = JSON.stringify({ type: 'profile', profile: store.view(userId) });
  for (const ws of userSockets.get(userId) || []) if (ws.readyState === 1) ws.send(msg);
}

// Progress from a game: update the player's quest card, and tell them about finished quests.
function questProgress(userId, name, stat, n) {
  const { changed, completed } = quests.track(userId, name, stat, n);
  if (changed) sendQuests(userId);
  if (completed.length) sendTo(userId, { type: 'questsDone', completed });
}

function sendQuests(userId) {
  sendTo(userId, { type: 'quests', quests: quests.view(userId) });
}

function sendTo(userId, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of userSockets.get(userId) || []) if (ws.readyState === 1) ws.send(msg);
}

// "You came 2nd in last week's leaderboard: +200 coins" — sent once, when they're online.
function sendAwards(userId) {
  const sockets = [...(userSockets.get(userId) || [])].filter((ws) => ws.readyState === 1);
  if (!sockets.length) return; // told next time they connect
  const awards = leaderboard.takeAwards(userId);
  if (!awards.length) return;
  for (const ws of sockets) ws.send(JSON.stringify({ type: 'awards', awards }));
}

function broadcast(room) {
  const msg = JSON.stringify({ type: 'state', state: room.snapshot() });
  for (const ws of room.clients) if (ws.readyState === 1) ws.send(msg);
}

// Everyone's room list (in the menu) is sent again at most once a second after any change.
let listTimer = null;
function listsChanged() {
  if (listTimer) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    for (const ws of wss.clients) if (ws.ctx?.user) sendList(ws);
  }, LIST_EVERY_MS);
}

function sendList(ws) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'rooms', rooms: directory.list(ws.ctx.instanceId), ...activity() }));
}

// How busy the server is: shown in everyone's menu, and by /api/status.
function activity() {
  let games = 0;
  let playersInGames = 0;
  for (const room of directory.rooms.values()) {
    if (room.phase !== 'playing') continue;
    const here = room.seats.filter((s) => s && !s.bot && room.connected.has(s.userId)).length;
    if (here) games++;
    playersInGames += here;
  }
  return { online: userSockets.size, games, playersInGames };
}

// ---------- moving between rooms ----------

function enterRoom(ws, room) {
  ws.ctx.room = room;
  room.clients.add(ws);
  broadcast(room); // the newcomer gets the room's state (everyone else already did)
  listsChanged();
}

function leaveRoom(ws, message = null) {
  const { room, user } = ws.ctx;
  if (!room) return;
  ws.ctx.room = null;
  room.clients.delete(ws);
  room.disconnect(user);
  directory.left(room);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'left', message }));
  listsChanged();
}

// The host kicked someone: every connection they have to that room goes back to the menu.
function kickFromRoom(room, userId) {
  for (const ws of [...room.clients]) {
    if (ws.ctx.user.id === userId) leaveRoom(ws, `You were removed from ${room.name}`);
  }
}

function handleLobby(ws, msg) {
  const { user, instanceId } = ws.ctx;
  if (msg.op === 'create') {
    leaveRoom(ws);
    const room = directory.create(user, {
      visibility: msg.visibility,
      mode: msg.mode,
      instanceId,
      extra: { onKick: (userId) => kickFromRoom(room, userId) },
    });
    return enterRoom(ws, room);
  }
  if (msg.op === 'join') {
    const withCode = !!msg.code;
    const room = withCode ? directory.findCode(msg.code) : directory.get(String(msg.id || ''));
    if (!room) throw new Error(withCode ? 'No room with that code' : 'That room has closed');
    if (room === ws.ctx.room) return broadcast(room);
    directory.check(room, user, { instanceId, withCode });
    leaveRoom(ws);
    directory.join(room, user, { instanceId, withCode });
    return enterRoom(ws, room);
  }
  if (msg.op === 'leave') return leaveRoom(ws);
  if (msg.op === 'list') return sendList(ws);
}

async function resolveUser(hello) {
  if (hello.accessToken) {
    const tokenKey = createHash('sha256').update(hello.accessToken).digest('hex');
    const cached = tokenCache.get(tokenKey);
    if (cached) return cached;
    const r = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${hello.accessToken}` },
    });
    if (!r.ok) throw new Error('Discord auth failed');
    const u = await r.json();
    const user = { id: u.id, name: u.global_name || u.username };
    tokenCache.set(tokenKey, user);
    return user;
  }
  if (!ALLOW_GUESTS) throw new Error('Open this inside Discord');
  const name = String(hello.guestName || 'Guest').slice(0, 24);
  const id = /^[a-z0-9-]{8,40}$/i.test(hello.guestId || '') ? `guest-${hello.guestId}` : `guest-${randomUUID()}`;
  return { id, name };
}

wss.on('connection', (ws, req) => {
  // ws reports oversized frames (and broken sockets) through 'error'; without a listener it crashes
  // the process — so it's attached before anything can return early.
  ws.on('error', () => {});
  const ip = clientIp(req);
  if (wss.clients.size > MAX_SOCKETS_TOTAL) return ws.close(1013, 'Server busy');
  if ((socketsByIp.get(ip) || 0) >= MAX_SOCKETS_PER_IP || !connLimiter.hit(ip)) {
    return ws.close(1008, 'Too many connections');
  }
  socketsByIp.set(ip, (socketsByIp.get(ip) || 0) + 1);

  // user: who this is; instanceId: their Discord call ('local' in a browser); room: where they are
  ws.ctx = { user: null, instanceId: null, room: null };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const bucket = new TokenBucket({ capacity: MAX_MSG_BURST, refillPerSec: MSG_PER_SEC });
  let drops = 0;
  let lastSlowNotice = 0;
  const helloTimer = setTimeout(() => {
    if (!ws.ctx.user) ws.close(1008, 'Login timed out');
  }, HELLO_TIMEOUT_MS);

  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

  ws.on('message', async (raw) => {
    if (!bucket.take()) {
      drops += 1;
      const now = Date.now();
      if (now - lastSlowNotice >= SLOW_NOTICE_MS) {
        lastSlowNotice = now;
        send({ type: 'error', message: 'Slow down' });
      }
      if (drops >= MAX_MSG_DROPS) ws.close(1008, 'Too many messages');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      const { ctx } = ws;
      if (msg.type === 'hello') {
        if (ctx.user || ctx.helloPending) return; // already in, or Discord is being asked right now
        if (!helloLimiter.hit(ip)) {
          send({ type: 'error', message: 'Too many logins' });
          return ws.close(1008, 'Too many logins');
        }
        ctx.helloPending = true;
        let user;
        try {
          user = await resolveUser(msg);
        } finally {
          ctx.helloPending = false;
        }
        if (ws.readyState !== 1) return; // closed while we were checking with Discord
        clearTimeout(helloTimer);
        if ((userSockets.get(user.id)?.size || 0) >= MAX_SOCKETS_PER_USER) {
          send({ type: 'error', message: 'Too many open connections' });
          return ws.close(1008, 'Too many open connections');
        }
        ctx.user = user;
        ctx.instanceId = String(msg.instanceId || 'local').slice(0, 100);
        if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
        userSockets.get(user.id).add(ws);
        store.get(user.id);
        send({ type: 'welcome', you: user });
        sendProfile(user.id);
        sendList(ws);
        listsChanged(); // everyone's "players online" count
        sendAwards(user.id); // any leaderboard prizes won while they were away
        sendQuests(user.id);
        // Back after a refresh or a dropped connection: return to the same room if it's still open
        const room = msg.rejoin && directory.findCode(msg.rejoin);
        if (room) {
          try {
            directory.join(room, user, { instanceId: ctx.instanceId, withCode: true });
            enterRoom(ws, room);
          } catch (err) {
            send({ type: 'left', message: err.message });
          }
        } else if (msg.rejoin) {
          send({ type: 'left', message: null }); // it closed while they were away
        }
        return;
      }
      if (!ctx.user) return send({ type: 'error', message: 'Not connected yet' });
      if (msg.type === 'lobby') return handleLobby(ws, msg);
      if (msg.type === 'leaderboard') return send({ type: 'leaderboard', boards: leaderboard.view(ctx.user.id) });
      if (msg.type === 'quests') return send({ type: 'quests', quests: quests.view(ctx.user.id) });
      if (msg.type === 'action') {
        if (!ctx.room) throw new Error('Join a room first');
        return ctx.room.handle(ctx.user, msg);
      }
      if (msg.type === 'shop') {
        if (msg.op === 'buy') store.buy(ctx.user.id, msg.item);
        else if (msg.op === 'equip') store.equip(ctx.user.id, msg.item);
        else return;
        if (ctx.room) broadcast(ctx.room); // skins and themes are visible to everyone
      }
    } catch (err) {
      send({ type: 'error', message: err.message || 'Something went wrong' });
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    const n = (socketsByIp.get(ip) || 1) - 1;
    if (n > 0) socketsByIp.set(ip, n);
    else socketsByIp.delete(ip);
    const { user, room } = ws.ctx;
    if (!user) return;
    const sockets = userSockets.get(user.id);
    sockets?.delete(ws);
    if (sockets?.size === 0) {
      userSockets.delete(user.id);
      listsChanged(); // one fewer online
    }
    if (room) {
      ws.ctx.room = null;
      room.clients.delete(ws);
      room.disconnect(user);
      directory.left(room);
      listsChanged();
    }
  });
});

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

// Save coins and open rooms before exiting (pm2 restart sends SIGINT).
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    saveRooms();
    store.flush();
    leaderboard.flush();
    quests.flush();
    process.exit(0);
  });
}

restoreRooms(); // last, once everything rooms talk to is set up

server.listen(PORT, () => {
  console.log(`Ludo server running on http://localhost:${PORT}`);
  if (!CLIENT_ID) console.log('⚠  DISCORD_CLIENT_ID is not set — only guest (browser) mode will work.');
  if (FREE_SHOP) console.log('🛒 FREE_SHOP is on — every shop item costs 0 coins.');
});
