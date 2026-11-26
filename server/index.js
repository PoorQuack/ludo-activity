import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomDirectory } from './rooms.js';
import { Purchases, parseSkus } from './purchases.js';
import { parseStripePrices, renderResultPage, renderStorePage, StripeStore } from './stripe.js';
import { ProfileStore } from './store.js';
import { Leaderboard } from './leaderboard.js';
import { QuestBook } from './quests.js';
import { TokenBucket, KeyedLimiter, TtlCache } from './limits.js';
import { rig, unrig, riggedList } from './rig.js';
import { SupportDesk, SUPPORT_MAX_FILE } from './support.js';
import { ServerInvite, SNOOZE_MS } from './invite.js';
import { SocialBook, sendDm } from './social.js';
import { Inbox } from './inbox.js';
import { LobbyChat, channelId } from './lobbychat.js';
import { DirectMessages, pairKey } from './dms.js';
import { Translator, LANGS } from './translate.js';
import { TranslationFeedback } from './tr-feedback.js';
import { PASS_XP } from '../shared/pass.js';
import { playerLevel } from '../shared/badges.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'profiles.json');
// Open rooms are written here when the server stops and read back when it starts, so an
// update (pm2 restart) doesn't end anyone's game: players reconnect and carry on.
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(path.dirname(DATA_FILE), 'rooms.json');
// Weekly and monthly leaderboards (scores, last winners, prizes paid), next to the profiles.
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(path.dirname(DATA_FILE), 'leaderboard.json');
const LOBBY_CHAT_FILE = process.env.LOBBY_CHAT_FILE || path.join(path.dirname(DATA_FILE), 'lobby-chat.json');
const DMS_FILE = process.env.DMS_FILE || path.join(path.dirname(DATA_FILE), 'dms.json');
// Today's daily quest progress (reset at midnight UTC).
const QUESTS_FILE = process.env.QUESTS_FILE || path.join(path.dirname(DATA_FILE), 'quests.json');
const WEEKLY_QUESTS_FILE = process.env.WEEKLY_QUESTS_FILE || path.join(path.dirname(DATA_FILE), 'quests-weekly.json');
const SUPPORT_FILE = process.env.SUPPORT_FILE || path.join(path.dirname(DATA_FILE), 'support.json');
const TR_FEEDBACK_FILE = process.env.TR_FEEDBACK_FILE || path.join(path.dirname(DATA_FILE), 'translation-feedback.json');
// Friends and "played with" lists
const SOCIAL_FILE = process.env.SOCIAL_FILE || path.join(path.dirname(DATA_FILE), 'social.json');
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Guests = playing in a normal browser tab without Discord (handy for testing).
const ALLOW_GUESTS = (process.env.ALLOW_GUESTS ?? 'true') === 'true';
// For testing skins: every shop item costs 0 coins.
const FREE_SHOP = process.env.FREE_SHOP === 'true';
const INBOX_FILE = process.env.INBOX_FILE || path.join(path.dirname(DATA_FILE), 'inbox.json');
// Discord user ids (comma-separated) who can post announcements from inside the game
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://ludo.commontern.com').trim().replace(/\/+$/, '');
const ROOM_IDLE_MS = 2 * 60_000; // an empty room waits this long (for a refresh to rejoin) before closing
const LIST_EVERY_MS = 1000; // the room list in everyone's menu refreshes at most this often

const app = express();
// Stripe webhooks must see the unparsed request body for HMAC signature verification.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  try {
    const event = stripe.verifyWebhook(req.body, req.headers['stripe-signature']);
    await stripe.handleWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.warn('Stripe webhook rejected:', err.message);
    res.status(400).send(err.message);
  }
});
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
const purchaseLimiter = new KeyedLimiter({ max: 10, windowMs: 60_000 }); // purchase checks with Discord per player per minute
const MAX_SOCKETS_PER_USER = 5;
const HELLO_TIMEOUT_MS = 15_000;
const socketsByIp = new Map(); // ip -> open socket count
// Verified Discord access tokens (hashed, never stored raw) so repeat hellos skip the Discord API.
const tokenCache = new TtlCache({ ttlMs: 10 * 60_000, maxEntries: 5000 });
setInterval(() => {
  connLimiter.prune();
  helloLimiter.prune();
  purchaseLimiter.prune();
  tokenLimiter.prune();
  tokenCache.prune();
}, 60_000).unref();

// "Buy me a coffee" for any amount: a Ko-fi / Buy Me a Coffee page (the fixed coffees and the
// coin packs are paid through Discord, see SHOP_SKUS)
const TIP_URL = /^https:\/\/\S+$/.test((process.env.TIP_URL || '').trim()) ? process.env.TIP_URL.trim() : '';
app.get('/api/config', async (_req, res) => {
  const webPrices = stripe.enabled ? await stripe.listPrices().catch(() => ({})) : {};
  res.json({
    clientId: CLIENT_ID,
    allowGuests: ALLOW_GUESTS,
    freeShop: FREE_SHOP,
    paid: {
      skus: purchases.enabled ? purchases.list() : [],
      tipUrl: TIP_URL,
      webStore: stripe.enabled,
      publicUrl: PUBLIC_URL,
      webPrices,
    },
  });
});

// Discord profile pictures, fetched from Discord's CDN by the server: the Activity can't load
// outside images itself. Kept in memory for an hour.
const avatarCache = new TtlCache({ ttlMs: 60 * 60_000, maxEntries: 500 });
app.get('/api/avatar/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^\d{5,25}$/.test(id)) return res.status(404).end();
  const hash = social.avatars.get(id);
  if (hash === undefined) return res.status(404).end();
  const key = `${id}/${hash}`;
  let img = avatarCache.get(key);
  if (!img) {
    const url = hash
      ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
    try {
      const r = await fetch(url);
      if (!r.ok) return res.status(404).end();
      img = { type: r.headers.get('content-type') || 'image/png', body: Buffer.from(await r.arrayBuffer()) };
      avatarCache.set(key, img);
    } catch {
      return res.status(502).end();
    }
  }
  res.set({ 'Content-Type': img.type, 'Cache-Control': 'public, max-age=3600' }).send(img.body);
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

// Requests from the VM itself only: anything through the Cloudflare tunnel carries
// cf-connecting-ip, and the game is only reachable from outside through the tunnel.
const fromVm = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'];

// Admin: give a player coins, or gems with { currency: 'gems' } (scripts/give-coins.sh). VM only. Takes effect at once, and the
// player's coin count updates live if they're online.
app.post('/api/admin/coins', (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  const userId = String(req.body?.userId || '');
  const amount = Number(req.body?.amount);
  if (!/^(\d{5,25}|guest-[a-z0-9-]{8,48})$/i.test(userId)) return res.status(400).json({ error: 'userId should be a Discord user id (digits)' });
  if (!Number.isInteger(amount) || Math.abs(amount) > 1e9) return res.status(400).json({ error: 'amount should be a whole number (up to 1,000,000,000)' });
  // { currency: 'gems' } gives VIP Gems instead (testing, or making up for a failed purchase)
  const gems = req.body?.currency === 'gems';
  const now = gems ? store.adminGems(userId, amount) : store.adminCoins(userId, amount);
  store.flush();
  const unit = gems ? 'gems' : 'coins';
  console.log(`Admin: ${amount >= 0 ? 'gave' : 'took'} ${Math.abs(amount)} ${unit} ${amount >= 0 ? 'to' : 'from'} ${userId} (now ${now})`);
  res.json({ userId, [unit]: now });
});

// Announcements (scripts/announce.sh), VM only: everyone gets it in their inbox, live if they're
// online. { title, body } posts; { delete: id } takes one down.
app.post('/api/admin/announce', (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  try {
    if (req.body?.delete) {
      const deleted = inbox.unannounce(String(req.body.delete));
      for (const id of userSockets.keys()) sendInbox(id);
      return res.json({ deleted });
    }
    const item = inbox.announce(req.body?.title, req.body?.body);
    inbox.flush();
    announceToAll(item);
    console.log(`Admin: announced "${item.title}"`);
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Testing (scripts/rig-dice.sh), VM only: a player starts every turn with two 6s for a while.
// Games with a rigged roll pay no coins or leaderboard points. Cleared by a restart.
app.post('/api/admin/rig', (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  const userId = String(req.body?.userId || '');
  if (req.body?.off) {
    unrig(userId);
    console.log(`Admin: dice back to normal for ${userId}`);
  } else if (userId) {
    if (!/^(\d{5,25}|guest-[a-z0-9-]{8,48})$/i.test(userId)) return res.status(400).json({ error: 'userId should be a Discord user id (digits)' });
    const minutes = Math.min(24 * 60, Math.max(1, Number(req.body?.minutes) || 60));
    rig(userId, minutes);
    console.log(`Admin: rigged dice for ${userId} for ${minutes} min`);
  }
  res.json({ rigged: riggedList() });
});

// The screenshot or video for a support request, sent as the raw file with the one-time ticket the
// request got back over the socket (the socket only takes small messages).
app.post('/api/support/upload', express.raw({ type: () => true, limit: SUPPORT_MAX_FILE + 1024 }), async (req, res) => {
  try {
    res.json(await support.uploadFile(req.query.ticket, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Support setup check (scripts/support-test.sh), VM only: sends the owner a test DM and says
// what Discord answered, plus how many requests are saved and waiting.
app.post('/api/admin/support-test', async (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  const ok = await support.dm({ content: '✅ Ludo support test: bug reports will arrive here.' });
  res.json({ ok, error: support.lastError, saved: support.data.requests.length, waiting: support.data.queue.length });
});

// Support, VM only (scripts/support-test.sh --send-waiting): send the digest of everything waiting
// now instead of at the daily time, and list the latest requests.
app.post('/api/admin/support-digest', async (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  const waiting = support.data.queue.length;
  await support.digest();
  const latest = support.data.requests.slice(-5).map((r) => ({ id: r.id, kind: r.kind, from: r.name, at: new Date(r.at).toISOString(), file: r.file?.name || null }));
  res.json({ sentWaiting: waiting - support.data.queue.length, stillWaiting: support.data.queue.length, error: support.data.queue.length ? support.lastError : null, latest });
});

// Tell everyone a server update is coming: a line in every room's chat and a note on screen.
// scripts/deploy.sh calls this (VM only) a few seconds before restarting the server.
const UPDATE_SOON = "🔧 Updating the game in a few seconds. You'll be disconnected briefly and reconnect on your own: your game is saved.";
function announce(text, kind = 'soon') {
  for (const room of directory.rooms.values()) room.systemChat(text);
  const msg = JSON.stringify({ type: 'notice', kind, text });
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg);
}
app.post('/api/admin/announce', (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  const text = String(req.body?.text || '').slice(0, 300).trim() || UPDATE_SOON;
  announce(text, req.body?.kind === 'info' ? 'info' : 'soon');
  console.log(`Admin: announced "${text}"`);
  res.json({ ok: true, connected: wss.clients.size });
});

// How busy the server is, for scripts/deploy.sh --when-quiet. Only answered on the VM itself:
// requests through the Cloudflare tunnel carry cf-connecting-ip and get a 404.
app.get('/api/status', (req, res) => {
  if (!fromVm(req)) return res.status(404).end();
  res.json({ rooms: directory.rooms.size, ...activity(), uptimeSec: Math.round(process.uptime()) });
});

const STORE_COOKIE = 'ludo_store';
const OAUTH_COOKIE = 'ludo_oauth';
const cookieOpts = (maxAgeSec) => [
  `Path=/`,
  `HttpOnly`,
  `SameSite=Lax`,
  `Max-Age=${maxAgeSec}`,
  ...(PUBLIC_URL.startsWith('https://') ? ['Secure'] : []),
].join('; ');
function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function storeUserFromReq(req) {
  const cookies = readCookies(req);
  const data = stripe.verifyToken(cookies[STORE_COOKIE]);
  if (!data?.userId) return null;
  const seen = social.avatars?.has?.(data.userId);
  return { id: data.userId, name: data.name || (seen ? undefined : null) || 'Player' };
}

app.get('/store', async (req, res) => {
  if (req.query.t) {
    const data = stripe.verifyToken(String(req.query.t));
    if (data?.userId) {
      const cookieTok = stripe.signToken({ userId: data.userId, name: data.name || 'Player' }, 7 * 86_400_000);
      res.setHeader('Set-Cookie', `${STORE_COOKIE}=${encodeURIComponent(cookieTok)}; ${cookieOpts(7 * 86_400)}`);
    }
    return res.redirect(302, '/store');
  }
  const user = storeUserFromReq(req);
  const profile = user ? store.peek(user.id) : null;
  const prices = stripe.enabled ? await stripe.listPrices().catch(() => ({})) : {};
  const notice = req.query.cancelled ? 'Checkout was cancelled. You were not charged.' : '';
  noCache(res);
  res.type('html').send(renderStorePage({ user, profile, prices, enabled: stripe.enabled, notice, authUrl: CLIENT_ID ? '/store/auth' : '' }));
});

app.get('/store/auth', (_req, res) => {
  if (!CLIENT_ID) return res.status(503).send('Discord sign-in is not configured.');
  const nonce = randomUUID();
  const state = stripe.signToken({ nonce }, 10 * 60_000);
  res.setHeader('Set-Cookie', `${OAUTH_COOKIE}=${encodeURIComponent(nonce)}; ${cookieOpts(600)}`);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${PUBLIC_URL}/store/callback`,
    scope: 'identify',
    state,
  });
  res.redirect(302, `https://discord.com/oauth2/authorize?${params}`);
});

app.get('/store/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const cookies = readCookies(req);
    const parsedState = stripe.verifyToken(state);
    if (!code || !parsedState?.nonce || parsedState.nonce !== cookies[OAUTH_COOKIE]) {
      return res.status(400).type('html').send(renderResultPage({ ok: false, title: 'Sign-in expired', body: 'Please go back to the store and try signing in with Discord again.' }));
    }
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${PUBLIC_URL}/store/callback`,
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok?.access_token) throw new Error('Discord login failed');
    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !/^\d{5,25}$/.test(String(me?.id || ''))) throw new Error('Could not read Discord profile');
    const name = String(me.global_name || me.username || 'Player').slice(0, 40);
    const sessionTok = stripe.signToken({ userId: String(me.id), name }, 7 * 86_400_000);
    res.setHeader('Set-Cookie', [
      `${STORE_COOKIE}=${encodeURIComponent(sessionTok)}; ${cookieOpts(7 * 86_400)}`,
      `${OAUTH_COOKIE}=; ${cookieOpts(0)}`,
    ]);
    res.redirect(302, '/store');
  } catch (err) {
    res.status(400).type('html').send(renderResultPage({ ok: false, title: 'Sign-in failed', body: err.message || 'Please try again.' }));
  }
});

app.post('/store/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${STORE_COOKIE}=; ${cookieOpts(0)}`);
  res.redirect(302, '/store');
});

app.get('/pay', async (req, res) => {
  try {
    let userId = '';
    let itemId = '';
    if (req.query.t) {
      const tok = stripe.verifyToken(String(req.query.t));
      if (!tok?.userId) throw new Error('Checkout link expired — tap the item in Ludo again.');
      userId = tok.userId;
      itemId = String(tok.itemId || req.query.item || '');
      // Also sign them into /store in case they press Back or Cancel in Stripe Checkout.
      const cookieTok = stripe.signToken({ userId, name: tok.name || 'Player' }, 7 * 86_400_000);
      res.setHeader('Set-Cookie', `${STORE_COOKIE}=${encodeURIComponent(cookieTok)}; ${cookieOpts(7 * 86_400)}`);
    } else {
      const u = storeUserFromReq(req);
      if (!u) return res.redirect(302, '/store');
      userId = u.id;
      itemId = String(req.query.item || '');
    }
    if (!itemId) return res.redirect(302, '/store');
    if (!purchaseLimiter.hit(`pay:${userId}`)) throw new Error('Too many checkout attempts — please wait a minute.');
    const session = await stripe.createCheckoutSession({ userId, itemId });
    res.redirect(303, session.url);
  } catch (err) {
    res.status(400).type('html').send(renderResultPage({ ok: false, title: 'Checkout unavailable', body: err.message || 'Please try again.' }));
  }
});

app.get('/pay/success', async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || '');
    const r = await stripe.confirmSession(sessionId);
    if (!r.paid) {
      return res.type('html').send(renderResultPage({ ok: false, title: 'Payment pending', body: 'Your payment has not finished processing yet. Switch back to Discord in a moment and your items will arrive automatically.' }));
    }
    const label = r.item?.kind === 'gems'
      ? `${r.item.gems} Die Gems have been added to your account.`
      : r.item?.kind === 'pass'
        ? 'Your Battle Pass is now active! Claim your unlocked rewards in Discord.'
        : 'Thank you so much for your coffee!';
    noCache(res);
    res.type('html').send(renderResultPage({ ok: true, title: 'Purchase complete!', body: `${label} Switch back to Discord — your profile is already updated.` }));
  } catch (err) {
    res.status(400).type('html').send(renderResultPage({ ok: false, title: 'Could not verify payment', body: err.message || 'If you were charged, return to Discord in a minute — the webhook will finish crediting your account.' }));
  }
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
const store = new ProfileStore(DATA_FILE, { onChange: sendProfile, onBadge: (id, reached) => sendTo(id, { type: 'badges', reached }), freeShop: FREE_SHOP });
// Coin packs and coffees bought with real money through Discord (SHOP_SKUS in .env)
const purchases = new Purchases({
  appId: CLIENT_ID,
  token: (process.env.DISCORD_BOT_TOKEN || '').trim(),
  skus: parseSkus(process.env.SHOP_SKUS),
  store,
});
// Stripe Web Store & Apple Pay / Safari checkout (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICES)
const stripe = new StripeStore({
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  signingSecret: process.env.CHECKOUT_SECRET || CLIENT_SECRET || process.env.STRIPE_SECRET_KEY,
  publicUrl: PUBLIC_URL,
  prices: parseStripePrices(process.env.STRIPE_PRICES),
  store,
  onFulfill: (userId, granted) => {
    for (const g of granted) sendTo(userId, { type: 'purchased', ...g });
  },
});
// Pay out anything this player bought that hasn't been paid yet, and tell them.
function claimPurchases(userId) {
  purchases
    .claim(userId)
    .then((granted) => {
      for (const g of granted) sendTo(userId, { type: 'purchased', ...g });
    })
    .catch((err) => console.error(`Purchases for ${userId}: ${err.message}`));
}
// (a local test copy, with no Discord app set up, ranks its browser guests so the boards can be tried)
const leaderboard = new Leaderboard(LEADERBOARD_FILE, { profiles: store, onAward: sendAwards, rankGuests: ALLOW_GUESTS && !CLIENT_ID });

// The menu's chat (Global, and one channel per language) and chat translation
const lobbyChat = new LobbyChat(LOBBY_CHAT_FILE, { profiles: store });
// 👍 / 👎 and players' better translations (server/tr-feedback.js)
const trFeedback = new TranslationFeedback(TR_FEEDBACK_FILE);
const translator = new Translator({
  feedback: trFeedback,
  nvidiaKey: process.env.NVIDIA_API_KEY,
  deeplKey: process.env.DEEPL_API_KEY,
  azureKey: process.env.AZURE_TRANSLATOR_KEY,
  azureRegion: process.env.AZURE_TRANSLATOR_REGION,
});
const lobbyListeners = new Set(); // sockets with the menu chat open; ws.ctx.lobbyLang says which language

function handleLobbyChat(ws, msg) {
  const { ctx } = ws;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  if (msg.op === 'join') {
    ctx.lobbyLang = LANGS.has(msg.lang) ? msg.lang : 'en';
    ctx.chatLang = ctx.lobbyLang;
    lobbyListeners.add(ws);
    return send({ type: 'lobbyChat', op: 'history', lang: ctx.lobbyLang, global: lobbyChat.history('global'), local: lobbyChat.history(`lang:${ctx.lobbyLang}`) });
  }
  if (msg.op === 'leave') {
    lobbyListeners.delete(ws);
    return;
  }
  const channel = msg.channel === 'lang' ? 'lang' : 'global';
  const id = channelId(channel, ctx.lobbyLang || 'en');
  const reach = (obj) => {
    for (const c of lobbyListeners) {
      if (channel === 'lang' && c.ctx.lobbyLang !== ctx.lobbyLang) continue;
      if (c.readyState === 1) c.send(JSON.stringify(obj));
    }
  };
  if (msg.op === 'say') {
    if (!lobbyListeners.has(ws)) throw new Error('Open the chat first');
    const m = lobbyChat.say(ctx.user, id, msg.text, { replyId: msg.replyId });
    if (m) {
      m.lang = ctx.lobbyLang || 'en'; // the language they chat in: what Translate guesses it's written in
      reach({ type: 'lobbyChat', op: 'msg', channel, msg: m });
      const ping = JSON.stringify({ type: 'lobbyChat', op: 'ping', channel, userId: m.userId });
      for (const c of wss.clients) {
        if (c === ws || lobbyListeners.has(c) || c.readyState !== 1 || !c.ctx?.user) continue;
        if (channel === 'lang' && (c.ctx.lobbyLang || 'en') !== ctx.lobbyLang) continue;
        c.send(ping);
      }
    }
    return;
  }
  if (msg.op === 'react') {
    if (!lobbyListeners.has(ws)) throw new Error('Open the chat first');
    const res = lobbyChat.react(ctx.user.id, id, msg.id, String(msg.emoji || ''));
    if (res) reach({ type: 'lobbyChat', op: 'react', channel, id: res.id, reactions: res.reactions });
    return;
  }
  if (msg.op === 'delete') {
    if (!ADMIN_IDS.has(ctx.user.id)) throw new Error("Only the game's owner can remove messages");
    if (lobbyChat.remove(id, Number(msg.id))) reach({ type: 'lobbyChat', op: 'removed', channel, id: Number(msg.id) });
  }
}

function sendDmSummary(userId) {
  if (!userId || String(userId).startsWith('guest-')) return;
  sendTo(userId, { type: 'dmSummary', threads: dms.threadsFor(userId), unread: dms.unreadCount(userId) });
}

function handleDm(ws, msg) {
  const { ctx } = ws;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  if (msg.op === 'list') return sendDmSummary(ctx.user.id);
  if (msg.op === 'open') {
    const friendId = String(msg.friendId || '');
    if (!/^\d{5,25}$/.test(friendId)) throw new Error('Pick a friend to message');
    const h = dms.history(ctx.user.id, friendId);
    return send({ type: 'dmHistory', friendId, friend: h.friend, msgs: h.msgs, unread: dms.unreadCount(ctx.user.id), threads: dms.threadsFor(ctx.user.id) });
  }
  if (msg.op === 'say') {
    const toId = String(msg.toId || '');
    const res = dms.send(ctx.user, toId, msg.text, { replyId: msg.replyId });
    if (!res) return;
    sendTo(ctx.user.id, { type: 'dmMsg', friendId: toId, msg: res.msg, unread: dms.unreadCount(ctx.user.id) });
    sendTo(toId, { type: 'dmMsg', friendId: ctx.user.id, msg: res.msg, unread: dms.unreadCount(toId) });
    return;
  }
  if (msg.op === 'react') {
    const toId = String(msg.toId || '');
    const res = dms.react(ctx.user.id, toId, msg.id, String(msg.emoji || ''));
    if (!res) return;
    sendTo(ctx.user.id, { type: 'dmReact', friendId: toId, id: res.id, reactions: res.reactions });
    sendTo(toId, { type: 'dmReact', friendId: ctx.user.id, id: res.id, reactions: res.reactions });
  }
}

// "Translate" under a chat message: the message is looked up here (so this can't be used to
// translate any text at all), then put into the player's language.
// The chat message a translation is about (in their room, or their menu chat channel)
function chatMessage(ctx, scope, msgId) {
  if (scope === 'room') return ctx.room?.chat.find((m) => m.id === msgId && !m.system) || null;
  if (scope === 'global' || scope === 'lang') return lobbyChat.find(channelId(scope, ctx.lobbyLang || 'en'), msgId) || null;
  return null;
}

// 👍 / 👎 on a translation, or a player's better one
function handleTrFeedback(ws, msg) {
  const { ctx } = ws;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const scope = String(msg.scope);
  const msgId = Number(msg.id);
  const to = String(msg.to);
  const reply = { type: 'trFeedback', scope, id: msgId };
  const found = chatMessage(ctx, scope, msgId);
  if (!found || !LANGS.has(to) || found.userId === ctx.user.id) return send({ ...reply, error: 'That message is gone' });
  const base = { to, text: found.text, from: String(msg.from || '').slice(0, 8), shown: String(msg.shown || '').slice(0, 400) };
  try {
    const r = msg.op === 'suggest' ? trFeedback.suggest(ctx.user.id, { ...base, suggestion: String(msg.text || '') }) : trFeedback.vote(ctx.user.id, { ...base, up: !!msg.up });
    send({ ...reply, ok: true, op: msg.op === 'suggest' ? 'suggest' : 'vote', ...r });
  } catch (err) {
    send({ ...reply, error: err.message });
  }
}

function handleTranslate(ws, msg) {
  const { ctx } = ws;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const scope = String(msg.scope);
  const msgId = Number(msg.id);
  const found = chatMessage(ctx, scope, msgId);
  const reply = { type: 'translated', scope, id: msgId };
  if (!found) return send({ ...reply, error: 'That message is gone' });
  // what it's probably written in: the writer's chat language (Riva Translate has to be told)
  let hint = found.lang || '';
  if (!hint) for (const c of userSockets.get(found.userId) || []) hint ||= c.ctx?.chatLang || '';
  translator
    .translate(ctx.user.id, found.text, String(msg.to), hint)
    .then((r) => {
      const to = String(msg.to);
      // already in their language (Spanish from Spain for a Latin American player counts, unless it changed)
      const already = r.from === to || (r.from.split('-')[0] === to.split('-')[0] && r.text.trim() === found.text.trim());
      send({ ...reply, text: r.text, from: r.from, already: already && !r.approved, approved: !!r.approved });
    })
    .catch((err) => send({ ...reply, error: err.message }));
}
setInterval(() => leaderboard.rollover(), 60_000).unref(); // pays out as soon as a week or month ends
// Finished daily quests add their points to the leaderboards.
// Bug reports and feedback from players, forwarded to the owner's Discord DMs (see support.js)
const support = new SupportDesk(SUPPORT_FILE, {
  token: (process.env.DISCORD_BOT_TOKEN || '').trim(),
  ownerId: (process.env.SUPPORT_USER_ID || '398077353785294853').trim(), // the owner's Discord id
});
// "Join our Discord server" card in the menu (see invite.js). INVITE_URL= (empty) turns it off.
const invite = new ServerInvite({
  url: (process.env.INVITE_URL ?? 'https://discord.gg/vByCBThFbM').trim(),
  token: (process.env.DISCORD_BOT_TOKEN || '').trim(),
});
async function maybeInvite(ws, userId) {
  if (!invite.enabled || !store.wantsInvite(userId)) return;
  if ((await invite.isMember(userId)) === true) return store.answerInvite(userId, 'join'); // already in
  if (ws.readyState === 1 && store.wantsInvite(userId)) ws.send(JSON.stringify({ type: 'invite', url: invite.url }));
}
const social = new SocialBook(SOCIAL_FILE);
const isOnline = (id) => userSockets.has(id);
const dms = new DirectMessages(DMS_FILE, { profiles: store, social, isOnline });
function sendFriends(userId) {
  sendTo(userId, { type: 'friends', ...social.view(userId, isOnline), inviteUrl: invite.enabled ? invite.url : null });
}
// The inbox: personal notices, announcements, and (from the friends book) requests waiting
const inbox = new Inbox(INBOX_FILE);
function sendInbox(userId) {
  sendTo(userId, { type: 'inbox', ...inbox.view(userId), requests: social.requests(userId), canAnnounce: ADMIN_IDS.has(userId) });
}
function announceToAll(item) {
  for (const id of userSockets.keys()) sendInbox(id);
  for (const id of userSockets.keys()) sendTo(id, { type: 'announcement', item });
}
// Two people's friends lists and inboxes changed (a request sent, answered or a friend removed)
function bothChanged(a, b) {
  for (const id of [a, b]) {
    sendFriends(id);
    sendInbox(id);
  }
}
// Someone came online, went offline or played a game: refresh the lists that show them.
function friendsChanged(userId) {
  for (const other of userSockets.keys()) {
    const u = social.users.get(other);
    if (other === userId || u?.friends.includes(userId) || u?.met.some((m) => m.id === userId)) sendFriends(other);
    if (other !== userId && dms.threads[pairKey(other, userId)]) sendDmSummary(other);
  }
}
// DM invites to people who weren't online: if one opens the game for the first time, whoever
// invited them gets the referral. Kept in memory for a week (a restart forgets them).
const dmInvites = new Map();
setInterval(() => {
  for (const [id, v] of dmInvites) if (Date.now() - v.at > 7 * 86_400_000) dmInvites.delete(id);
}, 3_600_000).unref();
async function inviteFriend(ws, toId) {
  const { user, room } = ws.ctx;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  try {
    if (!room?.code) throw new Error('Make or join a room first, then invite');
    const u = social.users.get(user.id);
    if (!u?.friends.includes(toId) && !u?.met.some((m) => m.id === toId)) throw new Error('You can invite friends and people you have played with');
    if (room.seats.some((s) => s?.userId === toId) || room.people?.has(toId)) throw new Error("They're already in your room");
    const name = social.names.get(toId) || 'them';
    if (!social.acceptsInvites(toId)) throw new Error(`${name} has turned off invitations`);
    social.checkInvite(user.id, toId);
    if (isOnline(toId)) {
      sendTo(toId, { type: 'roomInvite', from: user.name, fromId: user.id, code: room.code });
      return send({ type: 'friendInvited', name, how: 'game' });
    }
    if (toId.startsWith('guest-')) throw new Error(`${name} isn't online`);
    await sendDm(
      (process.env.DISCORD_BOT_TOKEN || '').trim(),
      toId,
      `🎲 **${user.name.replace(/[*_~`|>]/g, '')}** invited you to play Ludo! Open the Ludo activity in Discord and join with the code **${room.code}**.`,
    );
    if (!dmInvites.has(toId)) dmInvites.set(toId, { from: user.id, at: Date.now() });
    send({ type: 'friendInvited', name, how: 'dm' });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
}

// Daily quests pay coins. (The leaderboards only count games.)
const quests = new QuestBook(QUESTS_FILE, { onCoins: (userId, name, coins) => store.rewardCoins(userId, coins) });
const weekly = new QuestBook(WEEKLY_QUESTS_FILE, { period: 'week', onCoins: (userId, name, coins) => store.rewardCoins(userId, coins) });
const directory = new RoomDirectory({
  idleMs: ROOM_IDLE_MS,
  roomOptions: {
    profiles: store,
    onGameEnd: (results) => {
      leaderboard.record(results);
      // Someone's first game since being invited: pay whoever invited them
      for (const r of results) {
        const paid = r.userId && store.gameFinished(r.userId);
        if (paid) sendTo(paid.to, { type: 'referral', name: r.name, coins: paid.coins });
      }
    },
    onGameStart: (players) => {
      social.played(players);
      for (const p of players) sendFriends(p.userId);
    },
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
    for (const room of directory.rooms.values()) room.systemChat('✅ Update finished, welcome back! The game carries on where it was.');
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
  store.addStat(userId, stat, n); // lifetime totals for the badges
  const day = quests.track(userId, name, stat, n);
  const week = weekly.track(userId, name, stat, n);
  if (day.changed || week.changed) sendQuests(userId);
  const completed = [...day.completed, ...week.completed];
  if (completed.length) sendTo(userId, { type: 'questsDone', completed });
  // Battle Pass XP for each quest finished (not the all-done bonus)
  const xp = day.completed.filter((q) => !q.bonus).length * PASS_XP.daily + week.completed.filter((q) => !q.bonus).length * PASS_XP.weekly;
  if (xp) passXp(userId, store.addPassXp(userId, xp), xp);
}

// Tell them about XP gained, and a new tier reached
function passXp(userId, r, xp) {
  if (!r) return;
  sendTo(userId, { type: 'passXp', xp, tier: r.tier, tierUp: r.tier > r.before });
  sendProfile(userId);
}

function sendQuests(userId) {
  sendTo(userId, { type: 'quests', quests: quests.view(userId), weekly: weekly.view(userId) });
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
      stake: Number(msg.stake) || 0,
      winnerTakeAll: msg.winnerTakeAll === true,
      quick: msg.quick === true,
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
  if (msg.op === 'play') {
    // "Play now": sit down in an open game, or start a public one for others to find
    const open = directory.findOpen(user, instanceId);
    if (open) {
      leaveRoom(ws);
      directory.join(open, user, { instanceId });
      return enterRoom(ws, open);
    }
    leaveRoom(ws);
    const room = directory.create(user, { visibility: 'public', instanceId, extra: { onKick: (userId) => kickFromRoom(room, userId) } });
    enterRoom(ws, room);
    return ws.send(JSON.stringify({ type: 'playNew' }));
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
    const user = { id: u.id, name: u.global_name || u.username, avatar: u.avatar || '' };
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
    ws.isAlive = true;
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
    if (msg.type === 'ping') return send({ type: 'pong', t: msg.t });
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
        const isNew = !store.peek(user.id);
        store.get(user.id);
        const loginXp = store.passLogin(user.id); // the day's first visit: Battle Pass XP
        // A first visit through someone's invite: Discord's share link says who shared it; a DM
        // invite sent while they were away counts too.
        if (isNew) store.setReferrer(user.id, msg.referrerId || dmInvites.get(user.id)?.from);
        dmInvites.delete(user.id);
        social.seen(user.id, user.name, user.id.startsWith('guest-') ? undefined : user.avatar);
        send({ type: 'welcome', you: { id: user.id, name: user.name, avatar: !user.id.startsWith('guest-') } });
        sendProfile(user.id);
        if (loginXp) send({ type: 'passXp', xp: PASS_XP.login, tier: loginXp.tier, tierUp: loginXp.tier > loginXp.before, login: true });
        sendList(ws);
        listsChanged(); // everyone's "players online" count
        sendAwards(user.id); // any leaderboard prizes won while they were away
        sendQuests(user.id);
        maybeInvite(ws, user.id).catch(() => {});
        claimPurchases(user.id); // bought something while the game was closed?
        if (userSockets.get(user.id).size === 1) friendsChanged(user.id); // just came online
        sendFriends(user.id); // their own list, every connect (friendsChanged skips the person themselves)
        sendInbox(user.id);
        sendDmSummary(user.id);
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
      if (msg.type === 'claimPurchases') {
        if (!purchaseLimiter.hit(ctx.user.id)) return;
        return claimPurchases(ctx.user.id);
      }
      if (msg.type === 'checkout') {
        const reqId = String(msg.reqId || '').slice(0, 64);
        if (!stripe.enabled) return send({ type: 'checkoutUrl', reqId, error: 'Web checkout is not enabled' });
        if (ctx.user.id.startsWith('guest-')) return send({ type: 'checkoutUrl', reqId, error: 'Sign in with Discord first' });
        if (!purchaseLimiter.hit(`tok:${ctx.user.id}`)) return send({ type: 'checkoutUrl', reqId, error: 'Too many requests — wait a moment' });
        const itemId = typeof msg.itemId === 'string' && stripe.hasPrice(msg.itemId) ? msg.itemId : '';
        if (itemId === 'starter' && store.peek(ctx.user.id)?.starter) return send({ type: 'checkoutUrl', reqId, error: 'You already have the Starter Pack' });
        const token = stripe.signToken({ userId: ctx.user.id, name: ctx.user.name, itemId }, 30 * 60_000);
        const url = itemId ? `${PUBLIC_URL}/pay?t=${encodeURIComponent(token)}` : `${PUBLIC_URL}/store?t=${encodeURIComponent(token)}`;
        return send({ type: 'checkoutUrl', reqId, itemId, url });
      }
      if (msg.type === 'leaderboard') return send({ type: 'leaderboard', boards: leaderboard.view(ctx.user.id) });
      if (msg.type === 'quests') return send({ type: 'quests', quests: quests.view(ctx.user.id), weekly: weekly.view(ctx.user.id) });
      if (msg.type === 'invite') return store.answerInvite(ctx.user.id, String(msg.answer), SNOOZE_MS);
      if (msg.type === 'daily') return send({ type: 'daily', ...store.rollDaily(ctx.user.id) });
      if (msg.type === 'friend') {
        const id = String(msg.id || '');
        if (msg.op === 'invites') social.setInvites(ctx.user.id, !!msg.on);
        else if (msg.op === 'add') {
          const r = social.request(ctx.user.id, id);
          if (r === 'sent') sendTo(id, { type: 'friendRequest', from: { id: ctx.user.id, name: ctx.user.name } });
          if (r === 'accepted') inbox.add(id, { kind: 'friendAccepted', from: ctx.user.id, name: ctx.user.name });
          send({ type: 'friendResult', result: r, id });
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'accept') {
          social.accept(ctx.user.id, id);
          inbox.add(id, { kind: 'friendAccepted', from: ctx.user.id, name: ctx.user.name });
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'decline') {
          social.decline(ctx.user.id, id);
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'cancel') {
          social.cancel(ctx.user.id, id);
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'remove') {
          social.removeFriend(ctx.user.id, id);
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'block') {
          social.block(ctx.user.id, id);
          sendDmSummary(ctx.user.id);
          return bothChanged(ctx.user.id, id);
        } else if (msg.op === 'unblock') {
          social.unblock(ctx.user.id, id);
          sendDmSummary(ctx.user.id);
          return sendFriends(ctx.user.id);
        }
        return sendFriends(ctx.user.id);
      }
      if (msg.type === 'inbox') {
        if (msg.op === 'read') inbox.markRead(ctx.user.id);
        return sendInbox(ctx.user.id);
      }
      if (msg.type === 'inspect') {
        const targetId = String(msg.userId || '');
        if (!/^(\d{5,25}|guest-[a-z0-9-]{8,48})$/i.test(targetId)) return;
        const p = store.peek(targetId);
        const meSocial = social.user(ctx.user.id);
        let friendState = 'none';
        if (targetId === ctx.user.id) friendState = 'self';
        else if (targetId.startsWith('guest-') || ctx.user.id.startsWith('guest-')) friendState = 'guest';
        else if (meSocial.friends.includes(targetId)) friendState = 'friends';
        else if (meSocial.out.some((r) => r.id === targetId)) friendState = 'sent';
        else if (meSocial.in.some((r) => r.id === targetId)) friendState = 'incoming';
        const badges = p?.badges || {};
        const level = p ? playerLevel(p) : 1;
        const monthLb = leaderboard.boards?.month?.scores?.[targetId];
        const allLb = leaderboard.allTime?.scores?.[targetId];
        const botWins = p?.played?.botWins || 0;
        const botGames = p?.played?.botGames || 0;
        const wins = Math.max(p?.played?.wins || 0, (p?.stats?.win || 0) + botWins, (allLb?.wins || 0) + botWins, (monthLb?.wins || 0) + botWins);
        const games = Math.max(p?.played?.games || 0, (allLb?.games || 0) + botGames, (monthLb?.games || 0) + botGames, wins);
        const captures = (p?.stats?.capture || 0) + (p?.played?.botCaptures || 0);
        const sixes = (p?.stats?.six || 0) + (p?.played?.botSixes || 0);
        return send({
          type: 'playerProfile',
          user: {
            id: targetId,
            name: social.names.get(targetId) || monthLb?.name || allLb?.name || 'Player',
            avatar: !targetId.startsWith('guest-') && social.avatars.has(targetId),
            vip: !!(p && store.passActive(p)),
            frame: p?.equipped?.frame || 'frame-none',
            title: p?.title || '',
            badges,
            pins: Array.isArray(p?.pins) ? p.pins : [],
            level,
            stats: { games, wins, captures, sixes, botGames },
            friendState,
            blocked: social.isBlocked(ctx.user.id, targetId),
          },
        });
      }
      if (msg.type === 'announce') {
        if (!ADMIN_IDS.has(ctx.user.id)) throw new Error('Only the game\'s owner can post announcements');
        if (msg.op === 'delete') {
          inbox.unannounce(String(msg.id || ''));
          for (const uid of userSockets.keys()) sendInbox(uid);
          return;
        }
        const item = inbox.announce(msg.title, msg.body);
        console.log(`Announcement by ${ctx.user.id}: ${item.title}`);
        return announceToAll(item);
      }
      if (msg.type === 'friendInvite') return inviteFriend(ws, String(msg.to || ''));
      if (msg.type === 'lobbyChat') return handleLobbyChat(ws, msg);
      if (msg.type === 'dm') return handleDm(ws, msg);
      if (msg.type === 'pass') {
        const given = msg.op === 'claimAll' ? store.claimAllPass(ctx.user.id) : [{ lane: msg.lane, tier: Number(msg.tier), ...store.claimPass(ctx.user.id, String(msg.lane), Number(msg.tier)) }];
        sendProfile(ctx.user.id);
        return send({ type: 'passClaimed', given });
      }
      if (msg.type === 'translate') return handleTranslate(ws, msg);
      if (msg.type === 'trFeedback') return handleTrFeedback(ws, msg);
      if (msg.type === 'chatLang') {
        if (LANGS.has(msg.lang)) ctx.chatLang = msg.lang;
        return;
      }
      if (msg.type === 'support') {
        // ⚙ Settings → Contact the developer. The room and device help with bug reports.
        const room = ctx.room;
        const context = {
          room: room?.code,
          mode: room?.mode,
          phase: room?.phase,
          device: String(msg.device || '').slice(0, 200),
          version: String(msg.version || '').slice(0, 100),
        };
        const attach = msg.attach && typeof msg.attach === 'object' ? { size: Number(msg.attach.size) } : null;
        support
          .submit({ userId: ctx.user.id, name: ctx.user.name, kind: msg.kind, answers: msg.answers, attach, context })
          .then((r) => send({ type: 'supportSent', ...r }))
          .catch((err) => send({ type: 'supportError', message: err.message }));
        return;
      }
      if (msg.type === 'action') {
        if (!ctx.room) throw new Error('Join a room first');
        return ctx.room.handle(ctx.user, msg);
      }
      if (msg.type === 'shop') {
        if (msg.op === 'buy') store.buy(ctx.user.id, msg.item);
        else if (msg.op === 'buySet') store.buySet(ctx.user.id, msg.item);
        else if (msg.op === 'equip') store.equip(ctx.user.id, msg.item);
        else if (msg.op === 'gift') {
          // only to a person sitting in your room (not a bot, not yourself)
          const seat = ctx.room?.seats.find((x) => x && !x.bot && x.userId === msg.to && x.userId !== ctx.user.id);
          if (!seat) throw new Error('You can only gift to someone in your room');
          store.gift(ctx.user.id, seat.userId, msg.item);
          const note = JSON.stringify({ type: 'gift', from: ctx.user.name, item: msg.item });
          for (const sock of userSockets.get(seat.userId) || []) if (sock.readyState === 1) sock.send(note);
          send({ type: 'gifted', to: seat.name, item: msg.item });
        }
        // badges: the title under your name, and the badges pinned beside it
        else if (msg.op === 'title') store.setTitle(ctx.user.id, typeof msg.badge === 'string' ? msg.badge : '');
        else if (msg.op === 'pins') store.setPins(ctx.user.id, msg.pins);
        else return;
        if (ctx.room) broadcast(ctx.room); // skins and themes are visible to everyone
      }
    } catch (err) {
      send({ type: 'error', message: err.message || 'Something went wrong' });
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    lobbyListeners.delete(ws);
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
      friendsChanged(user.id);
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
}, 15_000);

// Save coins and open rooms before exiting (pm2 restart sends SIGINT).
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    // Rooms keep a chat line about it (saved with them), and open pages get a note and a
    // "service restart" close, so they say "updating" while they reconnect instead of just "offline".
    try {
      announce('🔧 Restarting for an update. Reconnecting in a few seconds…', 'restart');
    } catch (err) {
      console.error(`Couldn't announce the restart: ${err.message}`);
    }
    saveRooms();
    store.flush();
    leaderboard.flush();
    lobbyChat.flush();
    trFeedback.flush();
    dms.flush();
    quests.flush();
    weekly.flush();
    support.save();
    social.flush();
    inbox.flush();
    for (const ws of wss.clients) ws.close(1012, 'Server update');
    setTimeout(() => process.exit(0), 300); // a moment for those messages to go out
  });
}

restoreRooms(); // last, once everything rooms talk to is set up

server.listen(PORT, () => {
  console.log(`Ludo server running on http://localhost:${PORT}`);
  if (!CLIENT_ID) console.log('⚠  DISCORD_CLIENT_ID is not set — only guest (browser) mode will work.');
  if (FREE_SHOP) console.log('🛒 FREE_SHOP is on — every shop item costs 0 coins.');
  if (!support.enabled) console.log('📬 Support requests are only saved to data/support.json: set DISCORD_BOT_TOKEN and SUPPORT_USER_ID in .env to get them in your DMs.');
});
