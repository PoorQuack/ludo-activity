import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Guests = playing in a normal browser tab without Discord (handy for testing).
const ALLOW_GUESTS = (process.env.ALLOW_GUESTS ?? 'true') === 'true';
const ROOM_IDLE_MS = 5 * 60_000;

const app = express();
app.use(express.json());

app.get('/api/config', (_req, res) => {
  res.json({ clientId: CLIENT_ID, allowGuests: ALLOW_GUESTS });
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
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Room>} */
const rooms = new Map();
const idleTimers = new Map();

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, { onChange: broadcast });
    rooms.set(id, room);
  }
  clearTimeout(idleTimers.get(id));
  idleTimers.delete(id);
  return room;
}

function broadcast(room) {
  const msg = JSON.stringify({ type: 'state', state: room.snapshot() });
  for (const ws of room.clients) if (ws.readyState === 1) ws.send(msg);
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
  let user = null;
  let room = null;
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
      if (msg.type === 'hello') {
        if (user) return;
        user = await resolveUser(msg);
        if (ws.readyState !== 1) return; // closed while we were checking with Discord
        const roomId = String(msg.instanceId || 'local').slice(0, 100);
        room = getRoom(roomId);
        room.clients.add(ws);
        send({ type: 'welcome', you: user });
        room.connect(user);
        return;
      }
      if (!user || !room) return send({ type: 'error', message: 'Not connected yet' });
      if (msg.type === 'action') room.handle(user, msg);
    } catch (err) {
      send({ type: 'error', message: err.message || 'Something went wrong' });
    }
  });

  ws.on('close', () => {
    if (!room || !user) return;
    room.clients.delete(ws);
    room.disconnect(user);
    if (room.empty) {
      const id = room.id;
      idleTimers.set(
        id,
        setTimeout(() => {
          rooms.get(id)?.destroy();
          rooms.delete(id);
          idleTimers.delete(id);
        }, ROOM_IDLE_MS),
      );
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

server.listen(PORT, () => {
  console.log(`Ludo server running on http://localhost:${PORT}`);
  if (!CLIENT_ID) console.log('⚠  DISCORD_CLIENT_ID is not set — only guest (browser) mode will work.');
});
