// Discord notifications: when a player is away from the game (no open connection) and someone
// @mentions them (world chat, language chat, room chat) or a friend messages them, the app's
// bot DMs them on Discord. Every ping counts: there's no cap on how often people can ping.
//  - Grouped: the first ping starts a one-minute wait, and everything that arrives in that
//    minute goes out as one DM ("Ana mentioned you 6 times, Bo sent you 2 messages"). Back in
//    the game within the minute? Nothing is sent: they'll see it there.
//  - Quiet hours: pings are kept and sent as one summary when the quiet hours end.
//  - Only real Discord accounts (not guests), and only the kinds they leave on
//    (⚙ Settings → General: mentions, friends' messages).
//  - Each player's DMs go out one at a time, in order. When Discord says "slow down" (429),
//    we wait the time it asks and carry on, so nothing is dropped.
//  - Each DM is a card per sender: their Discord name and picture, the message, and an "Open Ludo" button that opens the activity on that chat.
//  - The DM channel with each player is remembered, so a notice is one call to Discord, not two.
//  - Bots can only DM people who share a server with them. When Discord refuses, that player is
//    skipped for an hour (they may join the server) instead of being retried on every message.
// Kept in memory only: a restart forgets waiting pings, remembered channels and refusals.

import { EMOTE_SLUGS } from '../shared/shop.js';

const API = 'https://discord.com/api/v10';
const REFUSED_MS = 60 * 60_000;
const MAX_WAITS = 5; // "slow down" answers in a row before a notice is given up
const MAX_QUEUED = 200; // notices waiting for one player (past that, the oldest are dropped)
export const GROUP_MS = 60_000; // the wait that groups a burst of pings into one DM
const QUIET_CHECK_MS = 10 * 60_000; // during quiet hours, look again this often
const MAX_LINES = 8; // senders listed in one summary

const plain = (s, max) =>
  String(s ?? '')
    .replace(/[*_~`|>\\]/g, '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());

export class DiscordNotifier {
  constructor({
    token = '',
    allowed = () => true,
    isOnline = () => false,
    quietNow = () => false,
    profileOf = () => null,
    appId = '',
    publicUrl = '',
    send = null,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    wait = sleep,
    timers = { set: (fn, ms) => setTimeout(fn, ms).unref?.() ?? null, clear: (h) => clearTimeout(h) },
    log = console,
  } = {}) {
    this.token = token;
    this.allowed = allowed; // (userId, 'mention' | 'dm') => false when they turned that kind off
    this.isOnline = isOnline; // (userId) => true while they have the game open
    this.quietNow = quietNow; // (userId) => true during their quiet hours
    this.profileOf = profileOf; // (userId) => { name, avatar (Discord hash or '') } for the card
    this.appId = appId; // the activity's application id, for the "Open Ludo" link
    this.publicUrl = publicUrl; // where the game's pictures are served (sticker images)
    this.timers = timers;
    this.waiting = new Map(); // userId -> { mentions: Map, messages: Map, timer }
    this.fetch = fetchImpl;
    this.send = send || ((token2, userId, body) => this.botDm(userId, body));
    this.now = now;
    this.wait = wait;
    this.log = log;
    this.channels = new Map(); // userId -> DM channel id
    this.refused = new Map(); // userId -> time Discord refused a DM
    this.queues = new Map(); // userId -> { items: [content], running }
    this.sent = 0;
    this.failed = 0;
  }

  get enabled() {
    return !!this.token;
  }

  // A call to Discord, waiting out "slow down" answers
  async call(url, body) {
    for (let i = 0; ; i++) {
      const r = await this.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status !== 429 || i >= MAX_WAITS) return r;
      const j = await r.json().catch(() => ({}));
      await this.wait(Math.min(30_000, Math.max(250, (Number(j.retry_after) || 1) * 1000)));
    }
  }

  async botDm(userId, body) {
    let ch = this.channels.get(userId);
    if (!ch) {
      const r = await this.call(`${API}/users/@me/channels`, { recipient_id: userId });
      if (!r.ok) throw new Error(`no DM channel (${r.status})`);
      ch = (await r.json()).id;
      this.channels.set(userId, ch);
      if (this.channels.size > 50_000) this.channels.delete(this.channels.keys().next().value);
    }
    const msg = typeof body === 'string' ? { content: body } : body;
    const r = await this.call(`${API}/channels/${ch}/messages`, { ...msg, allowed_mentions: { parse: [] } });
    if (!r.ok) {
      if (r.status === 404) this.channels.delete(userId);
      throw new Error(`DM refused (${r.status})`);
    }
  }

  // Queues a notice. Returns a promise (for tests) that never rejects: true once it's sent.
  notify(userId, content) {
    if (!this.enabled || !/^\d{5,25}$/.test(String(userId))) return Promise.resolve(false);
    if (this.now() - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) return Promise.resolve(false);
    let q = this.queues.get(userId);
    if (!q) this.queues.set(userId, (q = { items: [], running: null }));
    return new Promise((resolve) => {
      q.items.push({ content, resolve });
      if (q.items.length > MAX_QUEUED) q.items.shift().resolve(false);
      if (!q.running) q.running = this.drain(userId, q);
    });
  }

  async drain(userId, q) {
    while (q.items.length) {
      const { content, resolve } = q.items.shift();
      if (this.now() - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) {
        resolve(false);
        continue;
      }
      try {
        await this.send(this.token, userId, content);
        this.sent++;
        resolve(true);
      } catch (err) {
        this.failed++;
        this.refused.set(userId, this.now());
        this.log.warn?.(`Discord notice to ${userId} not sent: ${err.message}`);
        resolve(false);
      }
    }
    q.running = null;
    this.queues.delete(userId);
  }

  // A ping, held for the grouping wait. Returns false when it won't be sent at all.
  add(userId, kind, { fromId, from, text, where }) {
    if (!this.enabled || !/^\d{5,25}$/.test(String(userId)) || !this.allowed(userId, kind)) return false;
    if (this.now() - (this.refused.get(userId) ?? -Infinity) < REFUSED_MS) return false;
    let w = this.waiting.get(userId);
    if (!w) {
      this.waiting.set(userId, (w = { mentions: new Map(), messages: new Map(), timer: null }));
      w.timer = this.timers.set(() => this.flush(userId), GROUP_MS);
    }
    const list = kind === 'dm' ? w.messages : w.mentions;
    const key = kind === 'dm' ? String(fromId) : `${fromId}|${where}`;
    const e = list.get(key) || { fromId: String(fromId), from, where, count: 0, text: '' };
    list.delete(key); // (latest last)
    list.set(key, { ...e, from: from || e.from, count: e.count + 1, text, at: this.now() });
    if (list.size > 100) list.delete(list.keys().next().value);
    return true;
  }

  mention(userId, ping) {
    return this.add(userId, 'mention', ping);
  }

  message(userId, ping) {
    return this.add(userId, 'dm', ping);
  }

  // They opened the game: what was waiting is theirs to read there
  cancel(userId) {
    const w = this.waiting.get(userId);
    if (!w) return;
    this.timers.clear(w.timer);
    this.waiting.delete(userId);
  }

  // The wait is over: one DM with everything that arrived (unless they're back, or it's quiet hours)
  flush(userId) {
    const w = this.waiting.get(userId);
    if (!w) return Promise.resolve(false);
    if (this.isOnline(userId)) {
      this.waiting.delete(userId);
      return Promise.resolve(false);
    }
    if (this.quietNow(userId)) {
      w.timer = this.timers.set(() => this.flush(userId), QUIET_CHECK_MS);
      return Promise.resolve(false);
    }
    this.waiting.delete(userId);
    const body = summary(w, { profileOf: this.profileOf, appId: this.appId, publicUrl: this.publicUrl });
    return body ? this.notify(userId, body) : Promise.resolve(false);
  }
}

const PLACE = { room: 'your Ludo room', lang: 'the Ludo language chat', global: 'the Ludo world chat' };
const COLOR = { dm: 0xd9573b, mention: 0xf2bf3f }; // Ludo red for messages, gold for mentions
const times = (n) => (n === 1 ? '' : ` ${n} times`);

// Their Discord picture (the default one when they have none)
export function avatarUrl(id, hash) {
  if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith('a_') ? 'gif' : 'png'}?size=128`;
  let n = 0;
  try {
    n = Number((BigInt(id) >> 22n) % 6n);
  } catch {}
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}

// Where "Open Ludo" lands: a DM with that friend, the chat they were mentioned in, or the menu
export function openLink(appId, e) {
  if (!appId) return '';
  const to = !e ? 'menu' : e.kind === 'dm' ? `dm-${e.fromId}` : e.where === 'room' ? 'room' : `chat-${e.where === 'lang' ? 'lang' : 'global'}`;
  return `https://discord.com/activities/${appId}?custom_id=${encodeURIComponent(to)}`;
}

// Stickers in a message (:slug: codes): the first one is shown as the card's picture, and the
// text reads without the codes. A message that's only stickers says "a sticker".
export function readStickers(text) {
  const found = [];
  const rest = String(text ?? '')
    .replace(/:([a-z0-9-]+):/g, (m, slug) => (EMOTE_SLUGS[slug] ? (found.push(EMOTE_SLUGS[slug]), ' ') : m))
    .replace(/\s+/g, ' ')
    .trim();
  return { stickers: found, rest };
}

// One sender's card: their name and picture at the top, and what they said (or the sticker)
function card(e, profileOf, publicUrl) {
  const p = profileOf(e.fromId) || {};
  const name = plain(p.name || e.from, 60) || (e.kind === 'dm' ? 'A friend' : 'Someone');
  const { stickers, rest } = readStickers(e.text);
  const sticker = stickers[0] && publicUrl ? stickers[0] : null;
  const what =
    e.kind === 'dm'
      ? e.count > 1 ? `sent you ${e.count} messages` : sticker && !rest ? 'sent you a sticker' : 'sent you a message'
      : `mentioned you${times(e.count)} in ${PLACE[e.where] || PLACE.global}`;
  return {
    color: COLOR[e.kind],
    author: { name: `${name} ${what}`.slice(0, 256), icon_url: avatarUrl(e.fromId, p.avatar || '') },
    ...(rest || !sticker ? { description: plain(sticker ? rest : e.text, 600) || '…' } : {}),
    ...(sticker ? { image: { url: `${publicUrl}${sticker.img}` } } : { thumbnail: { url: avatarUrl(e.fromId, p.avatar || '') } }),
    footer: { text: 'Ludo' },
    timestamp: new Date(e.at || Date.now()).toISOString(),
  };
}

// The DM for what was waiting: a line for the phone's notification, a card per sender (up to
// 10, Discord's limit, latest last) and the "Open Ludo" button
export function summary({ mentions, messages }, { profileOf = () => null, appId = '', publicUrl = '' } = {}) {
  const items = [...[...mentions.values()].map((e) => ({ ...e, kind: 'mention' })), ...[...messages.values()].map((e) => ({ ...e, kind: 'dm' }))].sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!items.length) return null;
  const total = items.reduce((n, e) => n + e.count, 0);
  let content;
  if (items.length === 1) {
    const e = items[0];
    const name = plain(profileOf(e.fromId)?.name || e.from, 40) || 'Someone';
    const onlySticker = e.count === 1 && readStickers(e.text).stickers.length && !readStickers(e.text).rest;
    content = e.kind === 'dm' ? `💬 **${name}** sent you ${e.count > 1 ? `${e.count} messages` : onlySticker ? 'a sticker' : 'a message'} in Ludo` : `🔔 **${name}** mentioned you${times(e.count)} in Ludo`;
  } else content = `🔔 You have ${total} new pings in Ludo`;
  const shown = items.slice(-10);
  const more = items.length - shown.length;
  if (more > 0) content += ` (the latest ${shown.length} people below, and ${more} more)`;
  const last = items[items.length - 1];
  const url = openLink(appId, last); // (the latest one)
  return {
    content,
    embeds: shown.map((e) => card(e, profileOf, publicUrl)),
    ...(url ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open Ludo', url }] }] } : {}),
  };
}
