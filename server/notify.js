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
//  - The DM channel with each player is remembered, so a notice is one call to Discord, not two.
//  - Bots can only DM people who share a server with them. When Discord refuses, that player is
//    skipped for an hour (they may join the server) instead of being retried on every message.
// Kept in memory only: a restart forgets waiting pings, remembered channels and refusals.

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
    this.timers = timers;
    this.waiting = new Map(); // userId -> { mentions: Map, messages: Map, timer }
    this.fetch = fetchImpl;
    this.send = send || ((token2, userId, content) => this.botDm(userId, content));
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

  async botDm(userId, content) {
    let ch = this.channels.get(userId);
    if (!ch) {
      const r = await this.call(`${API}/users/@me/channels`, { recipient_id: userId });
      if (!r.ok) throw new Error(`no DM channel (${r.status})`);
      ch = (await r.json()).id;
      this.channels.set(userId, ch);
      if (this.channels.size > 50_000) this.channels.delete(this.channels.keys().next().value);
    }
    const r = await this.call(`${API}/channels/${ch}/messages`, { content, allowed_mentions: { parse: [] } });
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
    const e = list.get(key) || { from, where, count: 0, text: '' };
    list.delete(key); // (latest last)
    list.set(key, { ...e, from: from || e.from, count: e.count + 1, text });
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
    const content = summary(w);
    return content ? this.notify(userId, content) : Promise.resolve(false);
  }
}

const PLACE = { room: 'your Ludo room', lang: 'the Ludo language chat', global: 'the Ludo world chat' };
const times = (n) => (n === 1 ? '' : ` ${n} times`);

// The DM for what was waiting
export function summary({ mentions, messages }) {
  const items = [...[...mentions.values()].map((e) => ({ ...e, kind: 'mention' })), ...[...messages.values()].map((e) => ({ ...e, kind: 'dm' }))];
  if (!items.length) return '';
  const foot = '\n\nOpen the Ludo activity in Discord to reply.';
  if (items.length === 1) {
    const e = items[0];
    if (e.kind === 'dm') return `💬 **${plain(e.from, 40) || 'A friend'}** sent you ${e.count === 1 ? 'a message' : `${e.count} messages`} in Ludo:\n> ${plain(e.text, 180)}${foot}`;
    return `🔔 **${plain(e.from, 40) || 'Someone'}** mentioned you${times(e.count)} in ${PLACE[e.where] || PLACE.global}:\n> ${plain(e.text, 180)}${foot}`;
  }
  const total = items.reduce((n, e) => n + e.count, 0);
  const lines = items.slice(-MAX_LINES).map((e) =>
    e.kind === 'dm'
      ? `💬 **${plain(e.from, 40) || 'A friend'}** sent you ${e.count === 1 ? 'a message' : `${e.count} messages`}: “${plain(e.text, 100)}”`
      : `🔔 **${plain(e.from, 40) || 'Someone'}** mentioned you${times(e.count)} in ${PLACE[e.where] || PLACE.global}: “${plain(e.text, 100)}”`,
  );
  const more = items.length - lines.length;
  return `You have ${total} new pings in Ludo:\n${lines.join('\n')}${more > 0 ? `\n…and ${more} more` : ''}${foot}`;
}
