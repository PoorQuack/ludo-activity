import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomDirectory } from './rooms.js';
import { ProfileStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'profiles.json');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Guests = playing in a normal browser tab without Discord (handy for testing).
const ALLOW_GUESTS = (process.env.ALLOW_GUESTS ?? 'true') === 'true';
// For testing skins: every shop item costs 0 coins.
const FREE_SHOP = process.env.FREE_SHOP === 'true';
const ROOM_IDLE_MS = 2 * 60_000; // an empty room waits this long (for a refresh to rejoin) before closing
const LIST_EVERY_MS = 1000; // the room list in everyone's menu refreshes at most this often

const app = express();
app.use(express.json());

app.get('/api/config', (_req, res) => {
  res.json({ clientId: CLIENT_ID, allowGuests: ALLOW_GUESTS, freeShop: FREE_SHOP });
});

// Exchange the OAuth code from the Embedded App SDK for an access token.
app.post('/api/token', async (req, res) => {
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

const dist = path.join(__dirname, '..', 'dist');
// The page itself is never cached, so players always get the newest version after an update.
// Built files have a hash in their name that changes with every build, so those can be kept.
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
app.use(
  express.static(dist, {
    setHeaders(res, file) {
      if (file.endsWith('.html')) noCache(res);
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
app.get('*', (_req, res) => {
  noCache(res);
  res.sendFile(path.join(dist, 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const userSockets = new Map();
const store = new ProfileStore(DATA_FILE, { onChange: sendProfile, freeShop: FREE_SHOP });
const directory = new RoomDirectory({
  idleMs: ROOM_IDLE_MS,
  roomOptions: {
    profiles: store,
    onChange: (room) => {
      broadcast(room);
      listsChanged();
    },
  },
  onRemove: listsChanged,
});

function sendProfile(userId) {
  const msg = JSON.stringify({ type: 'profile', profile: store.peek(userId) });
  for (const ws of userSockets.get(userId) || []) if (ws.readyState === 1) ws.send(msg);
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
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'rooms', rooms: directory.list(ws.ctx.instanceId) }));
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
    const r = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${hello.accessToken}` },
    });
    if (!r.ok) throw new Error('Discord auth failed');
    const u = await r.json();
    return { id: u.id, name: u.global_name || u.username };
  }
  if (!ALLOW_GUESTS) throw new Error('Open this inside Discord');
  const name = String(hello.guestName || 'Guest').slice(0, 24);
  const id = /^[a-z0-9-]{8,40}$/i.test(hello.guestId || '') ? `guest-${hello.guestId}` : `guest-${randomUUID()}`;
  return { id, name };
}

wss.on('connection', (ws) => {
  // user: who this is; instanceId: their Discord call ('local' in a browser); room: where they are
  ws.ctx = { user: null, instanceId: null, room: null };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      const { ctx } = ws;
      if (msg.type === 'hello') {
        if (ctx.user) return;
        const user = await resolveUser(msg);
        if (ws.readyState !== 1) return; // closed while we were checking with Discord
        ctx.user = user;
        ctx.instanceId = String(msg.instanceId || 'local').slice(0, 100);
        if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
        userSockets.get(user.id).add(ws);
        store.get(user.id);
        send({ type: 'welcome', you: user });
        sendProfile(user.id);
        sendList(ws);
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
    const { user, room } = ws.ctx;
    if (!user) return;
    const sockets = userSockets.get(user.id);
    sockets?.delete(ws);
    if (sockets?.size === 0) userSockets.delete(user.id);
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

// Save coins before exiting.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flush();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Ludo server running on http://localhost:${PORT}`);
  if (!CLIENT_ID) console.log('⚠  DISCORD_CLIENT_ID is not set — only guest (browser) mode will work.');
  if (FREE_SHOP) console.log('🛒 FREE_SHOP is on — every shop item costs 0 coins.');
});
